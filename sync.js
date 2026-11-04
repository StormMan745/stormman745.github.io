/* Durable, account-scoped offline snapshots. No credentials or file bytes enter logs. */
(() => {
    const DB = 'petcare-offline-v1';
    let database;
    const queues = new Map(), flushing = new Map(), epochs = new Map(), timers = new Map(),seen=new Map();
    let retryDelay = 1000;
    let displayed = { phase: 'loading', pending: 0 };
    let realtime=null;
    const accountChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('petcare-account-control'):null;
    window.addEventListener('petcare:local-signout',event=>accountChannel?.postMessage({type:'signed-out',userId:event.detail.userId,all:event.detail.all===true}));
    if(accountChannel)accountChannel.onmessage=event=>{if(event.data?.type==='signed-out'&&(event.data.all||event.data.userId===activeUserId)){resetActiveAccountData();hideAllPages();document.getElementById('authPage').style.display='flex';document.querySelector('.bottom-menu').style.display='none';showLoginForm();}};
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    // A checklist entry identifies one task on one day for one pet, not just a task.
    const keyOf = (row, path = '') => row && typeof row === 'object'
        ? path === '/completedTasks' && row.id && row.petId && row.date
            ? JSON.stringify([String(row.petId), String(row.date), String(row.id)])
            : String(row.dbId ?? row.id ?? '')
        : '';
    const canonical = value => {
        const data = clone(value || {});
        if (Array.isArray(data.pets)) {data.pet = clone(data.pets.find(p=>keyOf(p)===String(data.activePetId)) || data.pets[0] || data.pet);if(data.pet)delete data.pet.photoData;}
        return data;
    };
    function merge(base, local, remote, path = '', conflicts = []) {
        if(same(local,remote))return clone(local);
        if(same(local,base))return clone(remote);
        if(same(remote,base))return clone(local);
        if(Array.isArray(local) && Array.isArray(remote) && (!base || Array.isArray(base)) && [...local,...remote,...(base||[])].every(x=>keyOf(x,path))) {
            const maps=[base||[],local,remote].map(a=>new Map(a.map(x=>[keyOf(x,path),x])));
            const ids=new Set([...maps[2].keys(),...maps[1].keys(),...maps[0].keys()]);
            return [...ids].map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${path}/${id}`,conflicts)).filter(x=>x!==undefined);
        }
        const object = x=>x && typeof x==='object' && !Array.isArray(x);
        if(object(local) && object(remote) && (!base || object(base))) {
            const result={};
            for(const key of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])) {
                if(['__proto__','constructor','prototype'].includes(key))continue;
                if(path==='' && key==='pet')continue;
                if(path==='' && key==='activePetId'){result[key]=local[key]??remote[key];continue;}
                const value=merge(base?.[key],local[key],remote[key],`${path}/${key}`,conflicts);
                if(value!==undefined)result[key]=value;
            }
            return result;
        }
        conflicts.push(path);
        return clone(local);
    }
    function openDB() {
        if(!database)database=new Promise((resolve,reject)=>{
            const request=indexedDB.open(DB,2);
            request.onupgradeneeded=()=>{ for(const name of ['profiles','files','outbox','preferences']) {const store=request.result.objectStoreNames.contains(name)?request.transaction.objectStore(name):request.result.createObjectStore(name);if(!store.indexNames.contains('userId'))store.createIndex('userId','userId');} };
            request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=null};resolve(request.result)};request.onerror=()=>reject(request.error);
        }).catch(error=>{database=null;throw error});
        return database;
    }
    async function store(name, mode, action) {
        const db=await openDB();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction(name,mode);let result;
            const request=action(tx.objectStore(name));if(request){request.onsuccess=()=>{result=request.result};}
            tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('local_write_failed'));
        });
    }
    const get=(name,key)=>store(name,'readonly',s=>s.get(key));
    const put=(name,key,value)=>store(name,'readwrite',s=>s.put(value,key));
    const remove=(name,key)=>store(name,'readwrite',s=>s.delete(key));
    async function all(name,uid) { return store(name,'readonly',s=>s.index('userId').getAll(IDBKeyRange.only(uid))); }
    function serial(uid, action) {
        const result=(queues.get(uid)||Promise.resolve()).catch(()=>{}).then(()=>navigator.locks?navigator.locks.request('petcare-local-'+uid,action):action());
        queues.set(uid,result);return result;
    }
    async function session(uid) {
        const {data,error}=await supabaseClient.auth.getSession();
        if(error || !data?.session || data.session.user.id!==uid || activeUserId!==uid)throw new Error('authentication_required');
        return data.session;
    }
    async function request(uid,path,body) {
        const auth=await session(uid);
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try {
            const response=await fetch(`${SUPABASE_URL}/${path}`,{method:body===undefined?'GET':'POST',
                headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},
                body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
            if(!response.ok)throw new Error(response.status===401?'authentication_required':`sync_http_${response.status}`);
            return await response.json();
        } finally { clearTimeout(timer); }
    }
    async function remote(uid) {
        const rows=await request(uid,`rest/v1/petcare_data?select=data,revision&user_id=eq.${encodeURIComponent(uid)}&limit=1`);
        return rows[0]||{data:{},revision:0};
    }
    function status(phase,pending=0) {
        displayed={phase,pending};
        window.dispatchEvent(new CustomEvent('petcare:sync-status',{detail:displayed}));
        const bar=document.getElementById('syncStatusBar');if(!bar)return;
        bar.hidden=!activeUserId;
        const labels={loading:'Проверяю сохранение…',saved:'Сохранено',pending:'Ожидает отправки',offline:'Нет связи · изменения сохраняются на устройстве',error:'Не удалось синхронизировать',conflict:'Есть изменения с другого устройства',storage:'Не удалось сохранить на устройстве. Освободите место и повторите действие.'};
        bar.querySelector('[role="status"]').textContent=labels[phase]||labels.pending;
        bar.dataset.phase=phase;
        bar.querySelector('button').hidden=phase==='saved'||phase==='loading';
    }
    function schedule(uid) {
        clearTimeout(timers.get(uid));
        if(activeUserId!==uid || !navigator.onLine)return;
        timers.set(uid,setTimeout(()=>flush(uid),retryDelay));retryDelay=Math.min(60000,retryDelay*2);
    }
    async function load(uid,legacy) {
        let state=await get('profiles',uid);
        if(!state) {
            let cloud=null;
            if(navigator.onLine)try{cloud=await remote(uid)}catch{}
            const local=legacy && typeof legacy==='object'?canonical(legacy):null;
            const hasCloud=cloud && Object.keys(cloud.data||{}).length;
            const data=local||(hasCloud?cloud.data:null);
            if(!data){status('offline');return null;}
            state={userId:uid,data:canonical(data),base:hasCloud?canonical(cloud.data):null,revision:cloud?.revision??null,pending:!hasCloud||!!local&&!same(local,canonical(cloud.data)),savedAt:Date.now()};
            if(local && hasCloud && !same(local,canonical(cloud.data)))state.conflict={remote:canonical(cloud.data),revision:cloud.revision,paths:['migration']};
            await put('profiles',uid,state);
        }
        status(state.conflict?'conflict':navigator.onLine?(state.pending?'pending':'saved'):'offline',Number(state.pending));
        if(!state.conflict)setTimeout(()=>flush(uid),0);
        seen.set(uid,canonical(state.data));
        return clone(state.data);
    }
    async function save(data,uid) {
        epochs.set(uid,(epochs.get(uid)||0)+1);
        const previous=seen.get(uid);seen.set(uid,canonical(data));
        try {
            await serial(uid,async()=>{
                const old=await get('profiles',uid)||{userId:uid,base:null,revision:null};
                const conflicts=[];const merged=previous&&old.data?canonical(merge(previous,canonical(data),canonical(old.data),'',conflicts)):canonical(data);
                const conflict=conflicts.length?{remote:old.data,base:old.base,revision:old.revision,peer:true,paths:conflicts}:old.conflict;
                await put('profiles',uid,{...old,data:merged,conflict,pending:true,savedAt:Date.now()});
                try{localStorage.setItem(`petcareData:${uid}`,JSON.stringify(merged));}catch{} // Compatibility copy; IndexedDB is authoritative.
            });
            status(navigator.onLine?'pending':'offline',1);
            if(activeUserId===uid)window.PetCareNative?.syncReminders();
        } catch(error){status('storage',1);throw error;}
        if(!navigator.onLine)return false;
        const synced=await flush(uid);
        const latest=await get('profiles',uid);
        if(latest?.pending){if(!latest.conflict)schedule(uid);return false;}
        return synced;
    }
    async function runFlush(uid) {
        if(activeUserId!==uid || !navigator.onLine)return false;
        try {
            for(let attempt=0;attempt<8;attempt++) {
                await (queues.get(uid)||Promise.resolve()).catch(()=>{});
                let state=await get('profiles',uid);if(!state)return false;
                if(state.conflict){status('conflict',1);return false;}
                const epoch=epochs.get(uid)||0;
                const cloud=await remote(uid);if(activeUserId!==uid)return false;
                const base=state.base===null?{}:canonical(state.base),local=canonical(state.data),server=canonical(cloud.data);
                let conflicts=[];
                let merged=state.pending?canonical(merge(base,local,server,'',conflicts)):server;
                if(state.pending && state.base===null && Object.keys(server).length && !same(local,server))conflicts=['migration'];
                if(conflicts.length) {
                    await serial(uid,async()=>{const latest=await get('profiles',uid);await put('profiles',uid,{...latest,conflict:{remote:server,revision:cloud.revision,paths:conflicts}})});
                    status('conflict',1);return false;
                }
                let result={data:server,revision:cloud.revision};
                if(state.pending) {
                    const sent=await request(uid,'rest/v1/rpc/petcare_sync_profile',{p_revision:cloud.revision,p_data:merged});
                    if(sent.conflict)continue;
                    result=sent;
                }
                await serial(uid,async()=>{
                    if(activeUserId!==uid)return;
                    const latest=await get('profiles',uid);
                    if((epochs.get(uid)||0)!==epoch){const overlaps=[];const rebased=canonical(merge(local,latest.data,canonical(result.data),'',overlaps));await put('profiles',uid,{...latest,data:rebased,base:canonical(result.data),revision:result.revision,conflict:overlaps.length?{remote:result.data,revision:result.revision,paths:overlaps}:latest.conflict});return;}
                    await put('profiles',uid,{...latest,data:canonical(result.data),base:canonical(result.data),revision:result.revision,pending:false,conflict:null});
                    seen.set(uid,canonical(result.data));
                    if(activeUserId===uid)window.dispatchEvent(new CustomEvent('petcare:snapshot',{detail:{userId:uid,data:canonical(result.data)}}));
                });
                state=await get('profiles',uid);
                if(!state.pending){retryDelay=1000;status('saved');window.dispatchEvent(new Event('petcare:flush-files'));return true;}
            }
            throw new Error('sync_busy');
        }catch(error){if(activeUserId===uid){status(navigator.onLine?'error':'offline',1);schedule(uid);}return false;}
    }
    function flush(uid=activeUserId) {
        if(!uid)return Promise.resolve(false);
        if(!flushing.has(uid)) {
            const job=()=>runFlush(uid);
            const result=(navigator.locks?navigator.locks.request(`petcare-sync-${uid}`,job):job()).finally(()=>{flushing.delete(uid)});
            flushing.set(uid,result);
        }
        return flushing.get(uid);
    }
    async function resolveConflict(choice) {
        const uid=activeUserId,state=await get('profiles',uid);if(!state?.conflict)return;
        if(activeUserId!==uid)return;
        const data=choice==='remote'?state.conflict.remote:state.data;
        await put('profiles',uid,{...state,data,base:state.conflict.peer?state.conflict.base:state.conflict.remote,revision:state.conflict.revision,conflict:null,pending:state.conflict.peer||choice!=='remote'});
        seen.set(uid,canonical(data));
        window.dispatchEvent(new CustomEvent('petcare:snapshot',{detail:{userId:uid,data}}));
        await flush(uid);
    }
    async function purge(uid) {
        clearTimeout(timers.get(uid));await (queues.get(uid)||Promise.resolve()).catch(()=>{});await remove('profiles',uid);
        for(const name of ['files','outbox','preferences'])for(const row of await all(name,uid))await remove(name,row.key);
        localStorage.removeItem(`petcareData:${uid}`);
    }
    window.addEventListener('online',()=>{retryDelay=1000;if(activeUserId)flush();window.dispatchEvent(new Event('petcare:flush-files'))});
    window.addEventListener('offline',()=>status('offline',displayed.pending));
    window.addEventListener('focus',()=>{if(activeUserId&&navigator.onLine)flush()});
    window.addEventListener('petcare:account-ready',()=>{
        if(realtime)supabaseClient.removeChannel(realtime);
        const uid=activeUserId;if(!uid)return;
        realtime=supabaseClient.channel('petcare-profile-sync-'+uid).on('postgres_changes',{event:'*',schema:'public',table:'petcare_data',filter:'user_id=eq.'+uid},()=>{if(activeUserId===uid)flush(uid)}).subscribe();
    });
    window.addEventListener('petcare:account-reset',()=>{if(realtime){supabaseClient.removeChannel(realtime);realtime=null;}for(const timer of timers.values())clearTimeout(timer);timers.clear();document.getElementById('syncStatusBar')?.setAttribute('hidden','')});
    window.PetCareSync={load,save,flush,resolveConflict,purge,get,put,remove,all,merge,canonical,request,status,session,
        async purgeAll(){await Promise.allSettled([...queues.values()]);for(const name of ['profiles','files','outbox','preferences'])await store(name,'readwrite',s=>s.clear());for(const key of Object.keys(localStorage))if(key===STORAGE_KEY||key.startsWith(STORAGE_KEY+':'))localStorage.removeItem(key);},
        get state(){return displayed},get version(){return '2026.11.04-daily.2'}};
})();
