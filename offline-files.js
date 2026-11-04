/* Originals and pending uploads are isolated by the signed-in account in IndexedDB. */
(() => {
    const sync=window.PetCareSync, urls=new Set(),handlers=new Map();let running=null;
    const BUCKETS=new Set(['petcare-documents','petcare-stories']);
    const fileKey=(uid,bucket,path)=>`${uid}:${bucket}:${path}`;
    const goodPath=(uid,path)=>typeof path==='string'&&path.startsWith(uid+'/')&&!/[\\\u0000-\u001f]/.test(path)&&!path.split('/').some(p=>p==='..'||p==='.');
    const check=result=>{if(result.error)throw result.error;return result.data};
    async function bound(uid) {
        const session=await sync.session(uid);
        return window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:`Bearer ${session.access_token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    }
    async function cache(uid,bucket,path,blob) {
        if(!goodPath(uid,path))throw new Error('invalid_file_path');
        const key=fileKey(uid,bucket,path);await sync.put('files',key,{key,userId:uid,bucket,path,blob,cachedAt:Date.now()});
    }
    async function download(bucket,path,uid=activeUserId) {
        if(!uid||!goodPath(uid,path))throw new Error('Войдите в аккаунт владельца файла.');
        const cached=await sync.get('files',fileKey(uid,bucket,path));
        if(cached?.blob)return cached.blob;
        if(!navigator.onLine)throw new Error('Этот файл ещё не сохранён для работы без связи. Подключитесь к интернету и откройте его один раз.');
        const client=await bound(uid),blob=check(await client.storage.from(bucket).download(path));
        if(activeUserId!==uid)throw new Error('Аккаунт изменился.');
        await cache(uid,bucket,path,blob);return blob;
    }
    async function enqueue(job) {
        if(!job.userId || job.userId!==activeUserId)throw new Error('Аккаунт изменился.');
        const key=job.key||`${job.userId}:${crypto.randomUUID()}`;
        await sync.put('outbox',key,{...job,key,generation:crypto.randomUUID(),createdAt:Date.now()});
        window.dispatchEvent(new Event('petcare:files-changed'));flush();
    }
    async function upload(bucket,path,blob,options={}) {
        const uid=activeUserId;
        await cache(uid,bucket,path,blob);
        await enqueue({key:`${uid}:upload:${bucket}:${path}`,userId:uid,type:'upload',bucket,path,options});
        return {path};
    }
    async function cachedRows(uid) {return (await sync.get('preferences',`documents:${uid}`))?.rows||[];}
    async function documentRows(uid=activeUserId, refresh=true) {
        let rows=await cachedRows(uid);
        if(refresh&&navigator.onLine) {
            try {const client=await bound(uid);rows=check(await client.from('petcare_documents').select('*').eq('user_id',uid).order('document_date',{ascending:false}));
                if(activeUserId!==uid)return [];
                await sync.put('preferences',`documents:${uid}`,{key:`documents:${uid}`,userId:uid,rows});
            }catch{window.dispatchEvent(new CustomEvent('petcare:files-error',{detail:{code:'file_list_unavailable'}}));}
        }
        const byId=new Map(rows.map(r=>[r.id,r]));
        for(const job of (await sync.all('outbox',uid)).sort((a,b)=>a.createdAt-b.createdAt)) {
            if(job.type==='document-put')byId.set(job.row.id,{...job.row,pending:true});
            if(job.type==='document-edit')byId.set(job.id,{...(byId.get(job.id)||job.row),...job.fields,deleted_at:job.conflict?.deleted?null:byId.get(job.id)?.deleted_at,pending:true,pendingConflict:!!job.conflict});
            if(job.type==='document-delete')byId.delete(job.id);
            if(job.type==='pet-documents-delete')for(const [id,row] of byId)if(row.pet_id===job.petId)byId.delete(id);
        }
        return [...byId.values()].filter(r=>!r.deleted_at);
    }
    async function putDocument(row,blob) {
        const uid=activeUserId;if(uid!==row.user_id)throw new Error('Аккаунт изменился.');
        await cache(uid,'petcare-documents',row.storage_path,blob);
        await enqueue({key:`${uid}:document-put:${row.id}`,userId:uid,type:'document-put',row});
    }
    const metadata=row=>Object.fromEntries(['title','category','document_date','record_id'].map(key=>[key,row[key]??null]));
    async function editDocument(row,fields) {const key=`${activeUserId}:document-edit:${row.id}`,old=await sync.get('outbox',key);await enqueue({key,userId:activeUserId,type:'document-edit',id:row.id,petId:row.pet_id,row:old?.row||row,base:old?.base||metadata(row),fields,conflict:old?.conflict});}
    async function deleteDocument(row) {await enqueue({userId:activeUserId,type:'document-delete',id:row.id,petId:row.pet_id});}
    async function removePet(petId,uid) {await enqueue({userId:uid,type:'pet-documents-delete',petId});}
    async function sendFile(client,uid,bucket,path,options={}) {
        const item=await sync.get('files',fileKey(uid,bucket,path));if(!item?.blob)throw new Error('missing_local_original');
        const result=await client.storage.from(bucket).upload(path,item.blob,{...options,upsert:false});
        if(result.error && Number(result.error.statusCode||result.error.status)!==409 && !/already exists/i.test(result.error.message||''))throw result.error;
    }
    async function process(job,client) {
        const uid=job.userId;
        if(handlers.has(job.type)){await handlers.get(job.type)(job,client);return;}
        if(!['upload','document-put','document-edit','document-delete','pet-documents-delete','legacy-pet-delete','remove'].includes(job.type))throw new Error('unknown_pending_operation');
        if(job.type==='upload')await sendFile(client,uid,job.bucket,job.path,job.options);
        if(job.type==='document-put') {
            const row=job.row;
            await sendFile(client,uid,'petcare-documents',row.storage_path,{contentType:row.mime_type});
            const result=await client.from('petcare_documents').insert(row);
            if(result.error) {
                const existing=check(await client.from('petcare_documents').select('id,storage_path').eq('user_id',uid).eq('id',row.id).maybeSingle());
                if(!existing||existing.storage_path!==row.storage_path)throw result.error;
            }
        }
        if(job.type==='document-edit'){
            const remote=check(await client.from('petcare_documents').select('*').eq('user_id',uid).eq('id',job.id).eq('pet_id',job.petId).maybeSingle());
            const sameJob=current=>current?.generation===job.generation&&current?.createdAt===job.createdAt;
            if(!remote||remote.deleted_at){const current=await sync.get('outbox',job.key);if(sameJob(current))await sync.put('outbox',job.key,{...current,conflict:{remote:remote?metadata(remote):null,deleted:true,missing:!remote},errorCode:'document_deleted'});throw new Error('document_deleted');}
            const conflicts=[],fields=sync.merge(job.base,job.fields,metadata(remote),'document',conflicts);
            if(conflicts.length){const current=await sync.get('outbox',job.key);if(sameJob(current))await sync.put('outbox',job.key,{...current,conflict:{remote:metadata(remote),revision:remote.revision}});throw new Error('document_conflict');}
            const updated=check(await client.from('petcare_documents').update(fields).eq('user_id',uid).eq('id',job.id).eq('revision',remote.revision).is('deleted_at',null).select('id'));
            if(!updated.length)throw new Error('document_conflict');
            // Rebase a newer local edit onto this acknowledged version. An older
            // response must never replace the newer draft or conflict with itself.
            const latest=await sync.get('outbox',job.key);
            if(latest&&!sameJob(latest)){
                const sent={...metadata(remote),...fields},rebaseConflicts=[];
                const rebased=sync.merge(job.fields,latest.fields,sent,'document',rebaseConflicts);
                await sync.put('outbox',job.key,{...latest,base:sent,fields:rebased,conflict:rebaseConflicts.length?{remote:sent}:null});
            }
        }
        if(job.type==='document-delete')check(await client.from('petcare_documents').update({deleted_at:new Date().toISOString()}).eq('user_id',uid).eq('id',job.id).eq('pet_id',job.petId));
        if(job.type==='pet-documents-delete')check(await client.from('petcare_documents').update({deleted_at:new Date().toISOString()}).eq('user_id',uid).eq('pet_id',job.petId));
        if(job.type==='legacy-pet-delete')check(await client.from('pets').delete().eq('user_id',uid).eq('id',job.id));
        if(job.type==='remove')await platform('trash-files',{bucket:job.bucket,paths:job.paths},uid);
    }
    async function platform(action,body={},uid=activeUserId) {
        return sync.request(uid,'functions/v1/petcare-platform',{action,...body});
    }
    async function flush() {
        if(running||!navigator.onLine||!activeUserId)return running;
        const uid=activeUserId;
        running=(async()=>{
            const client=await bound(uid);
            for(const job of (await sync.all('outbox',uid)).sort((a,b)=>a.createdAt-b.createdAt)) {
                if(activeUserId!==uid)break;
                try{await process(job,client);}catch(error){
                    if(activeUserId!==uid)break;
                    if(['document_conflict','document_deleted','care_conflict','care_access_denied'].includes(error.message)){const current=await sync.get('outbox',job.key);if(current?.generation===job.generation&&current?.createdAt===job.createdAt)await sync.put('outbox',job.key,{...current,errorCode:error.message});window.dispatchEvent(new CustomEvent('petcare:files-error',{detail:{code:error.message}}));continue;}
                    throw error;
                }
                const latest=await sync.get('outbox',job.key);
                if(latest?.generation===job.generation&&latest?.version===job.version&&latest?.createdAt===job.createdAt)await sync.remove('outbox',job.key);
            }
            if(activeUserId===uid) {
                await documentRows(uid,true);
                window.dispatchEvent(new Event('petcare:files-changed'));
            }
        })().catch(()=>{if(activeUserId===uid)window.dispatchEvent(new CustomEvent('petcare:files-error',{detail:{code:'file_sync_failed'}}));}).finally(()=>{running=null});
        return running;
    }
    const originalFrom=supabaseClient.storage.from.bind(supabaseClient.storage);
    supabaseClient.storage.from=bucket=>{
        const original=originalFrom(bucket);if(!BUCKETS.has(bucket))return original;
        return new Proxy(original,{get(target,name){
            if(name==='upload')return async(path,file,options)=>{try{return {data:await upload(bucket,path,file,options),error:null}}catch(error){return {data:null,error}}};
            if(name==='download')return async path=>{try{return {data:await download(bucket,path),error:null}}catch(error){return {data:null,error}}};
            if(name==='createSignedUrl')return async path=>{try{const blob=await download(bucket,path);const url=URL.createObjectURL(blob);urls.add(url);return {data:{signedUrl:url},error:null}}catch(error){return {data:null,error}}};
            if(name==='remove')return async paths=>{try{await enqueue({userId:activeUserId,type:'remove',bucket,paths});return {data:paths.map(name=>({name})),error:null}}catch(error){return {data:null,error}}};
            const value=target[name];return typeof value==='function'?value.bind(target):value;
        }});
    };
    window.addEventListener('petcare:flush-files',flush);
    window.addEventListener('petcare:account-ready',flush);
    window.addEventListener('petcare:account-reset',()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls.clear()});
    setInterval(()=>{if(activeUserId&&navigator.onLine)flush()},30000);
    window.PetCareFiles={download,upload,documentRows,putDocument,editDocument,deleteDocument,removePet,flush,platform,cache,
        async resolveDocument(id,choice){const uid=activeUserId;for(const job of await sync.all('outbox',uid))if(job.type==='document-edit'&&job.id===id){if(choice==='remote')await sync.remove('outbox',job.key);else if(job.conflict&&!job.conflict.missing){if(job.conflict.deleted)await platform('restore-document',{id},uid);await sync.put('outbox',job.key,{...job,base:job.conflict.remote,conflict:null,errorCode:null,createdAt:Date.now()});}}await flush();window.dispatchEvent(new Event('petcare:files-changed'));},
        register:(type,handler)=>handlers.set(type,handler),
        queue:enqueue,
        legacyDelete:id=>enqueue({userId:activeUserId,type:'legacy-pet-delete',id}),
        async pending(uid=activeUserId){return (await sync.all('outbox',uid)).length}};
})();
