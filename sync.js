/* Durable, account-scoped offline snapshots. No credentials or file bytes enter logs. */
(() => {
    const DB = 'petcare-offline-v1';
    let database;
    const queues = new Map(), flushing = new Map(), epochs = new Map(), timers = new Map(),seen=new Map();
    let retryDelay = 1000;
    let displayed = { phase: 'loading', pending: 0 };
    let realtime=null, accountGeneration=0;
    const stores=['profiles','files','outbox','preferences'];
    function accountGuard(uid) {
        const generation=accountGeneration;
        return () => {
            if (!uid || uid!==activeUserId || generation!==accountGeneration) throw new Error('Аккаунт изменился.');
        };
    }
    const accountChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('petcare-account-control'):null;
    window.addEventListener('petcare:local-signout',event=>accountChannel?.postMessage({type:'signed-out',userId:event.detail.userId,all:event.detail.all===true}));
    // Signal another tab without copying medical records or photos into Web Storage.
    const noticeKey='petcare-profile-notice';
    async function peerSaved(uid) {
        if (!uid || uid!==activeUserId || assistantLive.userId!==uid) return;
        const generation=accountGeneration, petId=assistantLive.petId;
        const state=await get('profiles',uid);
        if (state && generation===accountGeneration && activeUserId===uid && assistantLive.petId===petId
            && getAssistantLocalProfileKey(state.data,petId)!==assistantLive.cloudKey) scheduleAssistantProfileRefresh();
    }
    function signalSave(uid) {
        try {
            if (accountChannel) accountChannel.postMessage({type:'profile-saved',userId:uid});
            else { localStorage.setItem(noticeKey,uid); localStorage.removeItem(noticeKey); }
        } catch { /* The profile is already durable. */ }
    }
    window.addEventListener('storage',event=>{if(event.key===noticeKey && event.newValue)peerSaved(event.newValue).catch(()=>{});});
    if(accountChannel)accountChannel.onmessage=event=>{
        if(event.data?.type==='profile-saved')peerSaved(event.data.userId).catch(()=>{});
        if(event.data?.type==='signed-out'&&(event.data.all||event.data.userId===activeUserId)){resetActiveAccountData();hideAllPages();document.getElementById('authPage').style.display='flex';document.querySelector('.bottom-menu').style.display='none';showLoginForm();}
    };
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
            request.onupgradeneeded=()=>{ for(const name of stores) {const store=request.result.objectStoreNames.contains(name)?request.transaction.objectStore(name):request.result.createObjectStore(name);if(!store.indexNames.contains('userId'))store.createIndex('userId','userId');} };
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
    const put=(name,key,value,guard)=>store(name,'readwrite',s=>{guard?.();return s.put(value,key);});
    const remove=(name,key)=>store(name,'readwrite',s=>s.delete(key));
    async function writeStores(names, action) {
        const db=await openDB();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction(names,'readwrite');
            let failure;
            tx.oncomplete=()=>resolve();
            tx.onabort=()=>reject(failure || tx.error || new Error('local_write_failed'));
            try { action(tx); } catch(error) { failure=error; tx.abort(); }
        });
    }
    async function queueOriginal(file,job) {
        const guard=accountGuard(job.userId);
        await writeStores(['files','outbox'],tx=>{
            guard();
            if(file.userId!==job.userId)throw new Error('invalid_file_owner');
            tx.objectStore('files').put(file,file.key);
            tx.objectStore('outbox').put(job,job.key);
        });
    }
    // The comparison and write share one transaction, including across tabs.
    // undefined keeps the row; null deletes it; any other value replaces it.
    async function mutate(name,key,change) {
        const db=await openDB();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction(name,'readwrite'),table=tx.objectStore(name);let result,failure;
            const read=table.get(key);
            read.onsuccess=()=>{try{result=change(read.result);if(result===null)table.delete(key);else if(result!==undefined)table.put(result,key);}catch(error){failure=error;tx.abort();}};
            tx.oncomplete=()=>resolve(result);
            tx.onerror=tx.onabort=()=>reject(failure||tx.error||new Error('local_write_failed'));
        });
    }
    async function all(name,uid) { return store(name,'readonly',s=>s.index('userId').getAll(IDBKeyRange.only(uid))); }
    const count=(name,uid)=>store(name,'readonly',s=>s.index('userId').count(IDBKeyRange.only(uid)));
    function serial(uid, action) {
        const result=(queues.get(uid)||Promise.resolve()).catch(()=>{}).then(()=>navigator.locks?navigator.locks.request('petcare-local-'+uid,action):action())
            .finally(()=>{if(queues.get(uid)===result)queues.delete(uid);});
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
            if(!response.ok)throw new Error([401,403].includes(response.status)?'authentication_required':`sync_http_${response.status}`);
            return await response.json();
        } finally { clearTimeout(timer); }
    }
    async function remote(uid, revisionOnly=false) {
        const fields=revisionOnly?'revision':'data,revision';
        const rows=await request(uid,`rest/v1/petcare_data?select=${fields}&user_id=eq.${encodeURIComponent(uid)}&limit=1`);
        return rows[0]||{data:{},revision:0};
    }
    function status(phase,pending=0) {
        displayed={phase,pending};
        window.dispatchEvent(new CustomEvent('petcare:sync-status',{detail:displayed}));
        const bar=document.getElementById('syncStatusBar');if(!bar)return;
        bar.hidden=!activeUserId;
        const labels={loading:'Проверяю сохранение…',saved:'Сохранено',pending:'Ожидает отправки',offline:'Нет связи · изменения сохраняются на устройстве',auth:'Войдите в аккаунт снова для отправки. Изменения сохранены на устройстве.',error:'Не удалось синхронизировать',conflict:'Есть изменения с другого устройства',storage:'Не удалось сохранить на устройстве. Освободите место и повторите действие.'};
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
        const guard=accountGuard(uid);
        let state=await get('profiles',uid);
        guard();
        if(!state) {
            let cloud=null;
            if(navigator.onLine)try{cloud=await remote(uid)}catch{}
            guard();
            const local=legacy && typeof legacy==='object'?canonical(legacy):null;
            const hasCloud=cloud && Object.keys(cloud.data||{}).length;
            const data=local||(hasCloud?cloud.data:null);
            if(!data){status('offline');return null;}
            state={userId:uid,data:canonical(data),base:hasCloud?canonical(cloud.data):null,revision:cloud?.revision??null,pending:!hasCloud||!!local&&!same(local,canonical(cloud.data)),savedAt:Date.now()};
            if(local && hasCloud && !same(local,canonical(cloud.data)))state.conflict={remote:canonical(cloud.data),revision:cloud.revision,paths:['migration']};
            // Another tab may have saved a first edit while the initial network read was in flight.
            const seeded=await mutate('profiles',uid,current=>{guard();return current?undefined:state;});
            state=seeded || await get('profiles',uid);
        }
        guard();
        if(!state)return null;
        // Only retire an older version's copy after its IndexedDB replacement has committed.
        try{localStorage.removeItem(`petcareData:${uid}`);}catch{}
        status(state.conflict?'conflict':navigator.onLine?(state.pending?'pending':'saved'):'offline',Number(state.pending));
        if(!state.conflict)setTimeout(()=>flush(uid),0);
        seen.set(uid,canonical(state.data));
        return clone(state.data);
    }
    async function save(data,uid) {
        if(!uid || uid!==activeUserId)return false;
        const generation=accountGeneration, epoch=(epochs.get(uid)||0)+1;
        epochs.set(uid,epoch);
        const previous=seen.get(uid),snapshot=canonical(data);seen.set(uid,snapshot);
        try {
            await serial(uid,()=>mutate('profiles',uid,current=>{
                const old=current||{userId:uid,base:null,revision:null};
                const conflicts=[];const merged=previous&&old.data?canonical(merge(previous,snapshot,old.data,'',conflicts)):snapshot;
                const conflict=conflicts.length?{remote:old.data,base:old.base,revision:old.revision,peer:true,paths:conflicts}:old.conflict;
                return {...old,data:merged,conflict,pending:true,savedAt:Date.now()};
            }));
            if(generation!==accountGeneration || uid!==activeUserId)return false;
            signalSave(uid);
            status(navigator.onLine?'pending':'offline',1);
            window.PetCareNative?.syncReminders();
        } catch(error){
            if(generation===accountGeneration && uid===activeUserId){
                if(epochs.get(uid)===epoch)seen.set(uid,previous);
                status('storage',1);
            }
            throw error;
        }
        if(!navigator.onLine)return false;
        const synced=await flush(uid);
        const latest=await get('profiles',uid);
        if(latest?.pending){if(!latest.conflict)schedule(uid);return false;}
        return synced;
    }
    async function runFlush(uid) {
        if(activeUserId!==uid || !navigator.onLine)return false;
        const generation=accountGeneration;
        const current=()=>activeUserId===uid && accountGeneration===generation;
        let collision=null;
        try {
            for(let attempt=0;attempt<8;attempt++) {
                await (queues.get(uid)||Promise.resolve()).catch(()=>{});
                let state=await get('profiles',uid);if(!state || !current())return false;
                if(state.conflict){status('conflict',1);return false;}
                const epoch=epochs.get(uid)||0;
                if (!state.pending && state.revision!=null) {
                    const head=await remote(uid,true);
                    if(!current())return false;
                    if(head.revision===state.revision){
                        const latest=await get('profiles',uid);
                        if(!current() || !latest)return false;
                        if(latest.pending || latest.conflict || latest.revision!==head.revision || (epochs.get(uid)||0)!==epoch)continue;
                        // A peer tab can acknowledge a new revision before this tab gets its realtime event.
                        if(!same(seen.get(uid),latest.data)){
                            seen.set(uid,canonical(latest.data));
                            window.dispatchEvent(new CustomEvent('petcare:snapshot',{detail:{userId:uid,data:latest.data}}));
                        }
                        retryDelay=1000;status('saved');window.dispatchEvent(new Event('petcare:flush-files'));return true;
                    }
                }
                // Normal writes use the server's revision check. A collision includes the newer profile.
                const cloud=collision || (state.pending && state.base!=null && state.revision!=null
                    ? {data:state.base,revision:state.revision} : await remote(uid));
                collision=null;
                if(!current())return false;
                const base=state.base===null?{}:canonical(state.base),local=canonical(state.data),server=canonical(cloud.data);
                let conflicts=[];
                let merged=state.pending?canonical(merge(base,local,server,'',conflicts)):server;
                if(state.pending && state.base===null && Object.keys(server).length && !same(local,server))conflicts=['migration'];
                if(conflicts.length) {
                    const recorded=await serial(uid,()=>mutate('profiles',uid,latest=>{
                        if(!current() || !latest || latest.revision!==state.revision || !same(latest.data,state.data))return;
                        return {...latest,conflict:{remote:server,revision:cloud.revision,paths:conflicts}};
                    }));
                    if(!current())return false;
                    if(!recorded)continue;
                    status('conflict',1);return false;
                }
                let result={data:server,revision:cloud.revision};
                if(state.pending) {
                    const sent=await request(uid,'rest/v1/rpc/petcare_sync_profile',{p_revision:cloud.revision,p_data:merged});
                    if(!current())return false;
                    if(sent.conflict){collision=sent;continue;}
                    result=sent;
                }
                const accepted=canonical(result.data);
                const ack=await serial(uid,()=>mutate('profiles',uid,latest=>{
                    if(!current() || !latest || latest.conflict || latest.revision>result.revision)return;
                    if((epochs.get(uid)||0)!==epoch || !same(latest.data,local)){
                        if(!latest.pending)return;
                        const overlaps=[];
                        const data=canonical(merge(local,latest.data,accepted,'',overlaps));
                        return {...latest,data,base:accepted,revision:result.revision,pending:true,
                            conflict:overlaps.length?{remote:accepted,revision:result.revision,paths:overlaps}:null};
                    }
                    return {...latest,data:accepted,base:accepted,revision:result.revision,pending:false,conflict:null};
                }));
                if(!current())return false;
                if(!ack || ack.pending || (epochs.get(uid)||0)!==epoch)continue;
                seen.set(uid,accepted);
                window.dispatchEvent(new CustomEvent('petcare:snapshot',{detail:{userId:uid,data:clone(accepted)}}));
                retryDelay=1000;status('saved');window.dispatchEvent(new Event('petcare:flush-files'));return true;
            }
            throw new Error('sync_busy');
        }catch(error){if(current()){const auth=error.message==='authentication_required';status(navigator.onLine?(auth?'auth':'error'):'offline',1);if(!auth)schedule(uid);}return false;}
    }
    function flush(uid=activeUserId) {
        if(!uid)return Promise.resolve(false);
        if(!flushing.has(uid)) {
            const generation=accountGeneration;
            const job=()=>generation===accountGeneration && runFlush(uid);
            const result=Promise.resolve(navigator.locks?navigator.locks.request(`petcare-sync-${uid}`,job):job())
                .finally(()=>{if(flushing.get(uid)===result)flushing.delete(uid);});
            flushing.set(uid,result);
        }
        return flushing.get(uid);
    }
    async function resolveConflict(choice) {
        const uid=activeUserId,guard=accountGuard(uid);
        if(!uid || !['local','remote'].includes(choice))return;
        const saved=await serial(uid,()=>mutate('profiles',uid,state=>{
            guard();
            if(!state?.conflict)return;
            const {remote,base,revision,peer}=state.conflict;
            return {...state,data:choice==='remote'?remote:state.data,base:peer?base:remote,
                revision,conflict:null,pending:Boolean(peer)||choice==='local'};
        }));
        guard();
        if(!saved)return;
        seen.set(uid,canonical(saved.data));
        window.dispatchEvent(new CustomEvent('petcare:snapshot',{detail:{userId:uid,data:saved.data}}));
        await flush(uid);
    }
    async function purge(uid,{onlyIfSynced=false}={}) {
        if(!uid)return false;
        clearTimeout(timers.get(uid));
        let cleared=false;
        await serial(uid,()=>writeStores(stores,tx=>{
            const profiles=tx.objectStore('profiles');
            const clear=()=>{
                cleared=true;
                profiles.delete(uid);
                for(const name of ['files','outbox','preferences']){
                    const table=tx.objectStore(name);
                    const request=table.index('userId').openKeyCursor(IDBKeyRange.only(uid));
                    request.onsuccess=()=>{const cursor=request.result;if(cursor){table.delete(cursor.primaryKey);cursor.continue();}};
                }
            };
            if(!onlyIfSynced){clear();return;}
            const profile=profiles.get(uid);
            const jobs=tx.objectStore('outbox').index('userId').count(uid);
            jobs.onsuccess=()=>{if(!profile.result?.pending && !profile.result?.conflict && !jobs.result)clear();};
        }));
        if(!cleared)return false;
        seen.delete(uid);epochs.delete(uid);
        localStorage.removeItem(`petcareData:${uid}`);
        return true;
    }
    window.addEventListener('online',()=>{retryDelay=1000;if(activeUserId)flush();window.dispatchEvent(new Event('petcare:flush-files'))});
    window.addEventListener('offline',()=>status('offline',displayed.pending));
    window.addEventListener('focus',()=>{if(activeUserId&&navigator.onLine)flush()});
    window.addEventListener('petcare:account-ready',()=>{
        if(realtime)supabaseClient.removeChannel(realtime);
        const uid=activeUserId;if(!uid)return;
        realtime=supabaseClient.channel('petcare-profile-sync-'+uid).on('postgres_changes',{event:'*',schema:'public',table:'petcare_data',filter:'user_id=eq.'+uid},()=>{if(activeUserId===uid)flush(uid)}).subscribe();
    });
    window.addEventListener('petcare:account-reset',()=>{accountGeneration++;flushing.clear();seen.clear();epochs.clear();retryDelay=1000;displayed={phase:'loading',pending:0};if(realtime){supabaseClient.removeChannel(realtime);realtime=null;}for(const timer of timers.values())clearTimeout(timer);timers.clear();document.getElementById('syncStatusBar')?.setAttribute('hidden','')});
    window.PetCareSync={load,save,flush,resolveConflict,purge,get,put,remove,mutate,all,count,queueOriginal,accountGuard,merge,canonical,request,status,session,
        async purgeAll(){await Promise.allSettled([...queues.values()]);await writeStores(stores,tx=>{for(const name of stores)tx.objectStore(name).clear()});seen.clear();epochs.clear();for(const key of Object.keys(localStorage))if(key===STORAGE_KEY||key.startsWith(STORAGE_KEY+':'))localStorage.removeItem(key);},
        get state(){return displayed},get version(){return '2026.11.18-storage.1'}};
})();
