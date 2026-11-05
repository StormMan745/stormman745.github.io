import { createClient } from '@supabase/supabase-js';
const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const origins = new Set(['https://stormman745.github.io', 'https://www.stormman745.github.io', 'capacitor://localhost', 'ionic://localhost', 'petcare://localhost', 'null']);
const headersFor = (request: Request) => ({ 'Access-Control-Allow-Origin': request.headers.get('origin') || 'https://stormman745.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox", 'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin' });
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');
const check = (result: any) => { if (result.error) throw new Error('database_error'); return result.data; };
const petKey = (pet: any) => String(pet?.dbId ?? pet?.id ?? '');
const allowedIds = (ids: any, max = 100) => Array.isArray(ids) && ids.length <= max && ids.every(id => typeof id === 'string' && id.length <= 160);
const safeObject=(bucket:unknown,path:unknown)=>typeof bucket==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(bucket)&&!['.','..'].includes(bucket)&&typeof path==='string'&&path.length<=2048&&!/[\\\u0000-\u001f]/.test(path)&&!path.split('/').some(part=>part==='.'||part==='..');
const stripPet = (pet: any) => Object.fromEntries(['id','dbId','name','animal','breed','birthDate','sex','weight','color','allergies','medications','vetClinic','vetPhone','chipNumber'].filter(key => pet[key] != null).map(key => [key, pet[key]]));
const safeDiagnostics = (value: any) => ({ version: String(value?.version || '').slice(0,50), browser: String(value?.browser || '').slice(0,50),
    online: Boolean(value?.online), pending: Math.min(9999, Math.max(0, Number(value?.pending) || 0)),
    errorCodes: Array.isArray(value?.errorCodes) ? value.errorCodes.filter((code: unknown) => typeof code === 'string' && /^[a-z_]{1,40}$/.test(code)).slice(-20) : [] });

Deno.serve(async request => {
    const origin = request.headers.get('origin');
    if (origin && !origins.has(origin) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return new Response('Forbidden', { status: 403 });
    const reply = (data: unknown, status = 200, extraHeaders: Record<string,string> = {}) => new Response(JSON.stringify(data), { status, headers: { ...headersFor(request), 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headersFor(request) });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')) return reply({ error: 'json_required' }, 415);
    try {
        const reader=request.body?.getReader();const parts:Uint8Array[]=[];let size=0;
        if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return reply({error:'request_too_large'},413);}parts.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
        const text=new TextDecoder().decode(bytes);
        const body = JSON.parse(text);
        if(!body || typeof body!=='object' || Array.isArray(body))return reply({error:'invalid_request'},400);
        const action = body.action;
        if (action === 'maintenance') {
            const supplied=request.headers.get('x-petcare-cron-token')||'';
            if(supplied.length<24||supplied.length>256)return reply({error:'unauthorized'},401);
            const secrets=check(await admin.rpc('petcare_get_push_runtime_secrets'));
            const expected=secrets?.cronToken||'';let difference=supplied.length^expected.length;
            for(let i=0;i<Math.max(supplied.length,expected.length);i++)difference|=(supplied.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);
            if(difference)return reply({error:'unauthorized'},401);
            const due=check(await admin.from('petcare_file_trash').select('*').lt('delete_after',new Date().toISOString()).limit(500));
            let removed=0;
            for(const item of due){
                if(!safeObject(item.bucket_id,item.path))continue;
                if(item.bucket_id==='petcare-documents'){
                    const live=check(await admin.from('petcare_documents').select('id').eq('user_id',item.user_id).eq('storage_path',item.path).is('deleted_at',null).maybeSingle());
                    if(live){check(await admin.from('petcare_file_trash').delete().eq('user_id',item.user_id).eq('bucket_id',item.bucket_id).eq('path',item.path));continue;}
                }
                if(item.bucket_id==='petcare-stories'){
                    const current=check(await admin.from('petcare_data').select('data').eq('user_id',item.user_id).maybeSingle());
                    const referenced=(current?.data?.storyProjects||[]).some((story:any)=>[story.videoPath,story.collagePath,...(Array.isArray(story.photos)?story.photos.map((photo:any)=>photo.path):[])].includes(item.path));
                    if(referenced){check(await admin.from('petcare_file_trash').delete().eq('user_id',item.user_id).eq('bucket_id',item.bucket_id).eq('path',item.path));continue;}
                }
                check(await admin.storage.from(item.bucket_id).remove([item.path]));
                check(await admin.from('petcare_file_trash').delete().eq('user_id',item.user_id).eq('bucket_id',item.bucket_id).eq('path',item.path));removed++;
            }
            const cutoff=new Date(Date.now()-30*86400000).toISOString();
            for(const doc of check(await admin.from('petcare_documents').select('id,user_id,storage_path').lt('deleted_at',cutoff).limit(500))){
                if(!doc.storage_path.startsWith(`${doc.user_id}/${doc.id}/`))continue;
                check(await admin.storage.from('petcare-documents').remove([doc.storage_path]));
                check(await admin.from('petcare_documents').delete().eq('id',doc.id).lt('deleted_at',cutoff));removed++;
            }
            return reply({ok:true,removed});
        }
        if (action === 'share-view' || action === 'share-file') {
            if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return reply({ error: 'share_unavailable' }, 404);
            const share = check(await admin.from('petcare_vet_shares').select('*').eq('token_hash', await hash(body.token))
                .is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle());
            if (!share) return reply({ error: 'share_unavailable' }, 404);
            const budget=check(await admin.rpc('petcare_consume_vet_share',{p_share:share.id,p_action:action==='share-file'?'download':'view'}));
            if(budget?.unavailable)return reply({error:'share_unavailable'},404);
            if(budget?.allowed!==true){const retry=Math.max(1,Math.min(86400,Number(budget?.retryAfter)||60));return reply({error:'rate_limited',retryAfter:retry},429,{'Retry-After':String(retry)});}
            const docs = check(await admin.from('petcare_documents').select('id,title,category,document_date,file_name,mime_type,file_size,storage_path')
                .eq('user_id', share.user_id).eq('pet_id', share.pet_id).is('deleted_at', null).in('id', share.document_ids));
            if (action === 'share-view') return reply({ data: share.snapshot, expiresAt: share.expires_at, documents: docs.map(({ storage_path, ...row }: any) => row) });
            const doc = docs.find((row: any) => row.id === body.documentId);
            if (!doc || !doc.storage_path.startsWith(`${share.user_id}/${doc.id}/`)) return reply({ error: 'share_unavailable' }, 404);
            const file = check(await admin.storage.from('petcare-documents').download(doc.storage_path));
            return new Response(file, { headers: { ...headersFor(request), 'Content-Type': doc.mime_type,
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name)}` } });
        }
        const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
        const { data: auth, error: authError } = await admin.auth.getUser(token);
        if (authError || !auth?.user) return reply({ error: 'authentication_required' }, 401);
        const uid = auth.user.id;
        const key = request.headers.get('apikey');
        if (!key) return reply({ error: 'api_key_required' }, 401);
        const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
        // A signed JWT can outlive sign-out. All private actions, including
        // file export and analytics, also require its server session to exist.
        const active = await client.rpc('petcare_account_active');
        if (active.error || active.data !== true) return reply({ error: 'authentication_required' }, 401);
        // Quotas use the verified user's JWT, not the privileged service role.
        if (!['export-file','analytics-event'].includes(action)) {
            const limit = check(await client.rpc('petcare_consume_request', { p_action: 'profile-status' }));
            if (!limit?.allowed) return reply({ error: 'rate_limited', retryAfter: limit?.retryAfter || 60 }, 429, {'Retry-After':String(limit?.retryAfter||60)});
        }
        const profile = async () => check(await admin.from('petcare_data').select('data,revision').eq('user_id', uid).maybeSingle()) || { data: {}, revision: 0 };
        const ownPet = async () => {
            const account = await profile(); const pet = (account.data.pets || []).find((p: any) => petKey(p) === body.petId);
            if (!pet) throw new Error('pet_not_found'); return { account, pet };
        };
        if (action === 'share-create') {
            if (!allowedIds(body.recordIds) || !allowedIds(body.documentIds) || typeof body.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.tokenHash)) return reply({ error: 'invalid_selection' }, 400);
            const { account, pet } = await ownPet();
            const records = (account.data.healthRecords || []).filter((r: any) => String(r.petId) === body.petId && body.recordIds.includes(String(r.id)));
            const docs = check(await admin.from('petcare_documents').select('id').eq('user_id', uid).eq('pet_id', body.petId).is('deleted_at', null).in('id', body.documentIds));
            if (records.length !== body.recordIds.length || docs.length !== body.documentIds.length) return reply({ error: 'invalid_selection' }, 400);
            const hours = Math.min(168, Math.max(1, Number(body.hours) || 24));
            const activeShares=check(await admin.from('petcare_vet_shares').select('id').eq('user_id',uid).is('revoked_at',null).gt('expires_at',new Date().toISOString()));
            if(activeShares.length>=20)return reply({error:'too_many_shares'},429);
            if(new TextEncoder().encode(JSON.stringify({pet:stripPet(pet),healthRecords:records})).length>1000000)return reply({error:'selection_too_large'},400);
            const share = check(await admin.from('petcare_vet_shares').insert({ user_id: uid, pet_id: body.petId, token_hash: body.tokenHash,
                snapshot: { pet: body.includePet ? stripPet(pet) : {name:pet.name,animal:pet.animal}, healthRecords: records }, document_ids: body.documentIds, expires_at: new Date(Date.now()+hours*3600000).toISOString() }).select('id,expires_at').single());
            const stillPresent=(await profile()).data.pets?.some((p:any)=>petKey(p)===body.petId);
            if(!stillPresent){await admin.from('petcare_vet_shares').update({revoked_at:new Date().toISOString()}).eq('id',share.id).eq('user_id',uid);return reply({error:'pet_not_found'},404);}
            return reply(share);
        }
        if (action === 'share-list') return reply(check(await admin.from('petcare_vet_shares').select('id,pet_id,expires_at,revoked_at,created_at').eq('user_id', uid).order('created_at',{ascending:false}).limit(100)));
        if (action === 'share-revoke') { check(await admin.from('petcare_vet_shares').update({revoked_at:new Date().toISOString()}).eq('user_id',uid).eq('id',body.id)); return reply({ok:true}); }
        if (action === 'care-invite') {
            await ownPet();
            if (typeof body.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.tokenHash)) return reply({error:'invalid_token'},400);
            const existing=check(await admin.from('petcare_care_invites').select('id').eq('owner_id',uid).is('revoked_at',null).gt('expires_at',new Date().toISOString()));
            if(existing.length>=20)return reply({error:'too_many_invites'},429);
            return reply(check(await admin.from('petcare_care_invites').insert({owner_id:uid,pet_id:body.petId,token_hash:body.tokenHash}).select('id,expires_at').single()));
        }
        if (action === 'care-accept') {
            if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return reply({error:'invite_unavailable'},404);
            const accepted=check(await admin.rpc('petcare_accept_care',{p_user:uid,p_hash:await hash(body.token)}));
            if(!accepted)return reply({error:'invite_unavailable'},404);
            return reply({ok:true});
        }
        if (action === 'care-list') {
            const memberships=check(await admin.from('petcare_care_members').select('owner_id,pet_id,member_id,created_at').or(`owner_id.eq.${uid},member_id.eq.${uid}`));
            const invites=check(await admin.from('petcare_care_invites').select('id,pet_id,expires_at,revoked_at,used_by').eq('owner_id',uid).order('created_at',{ascending:false}).limit(30));
            return reply({memberships,invites});
        }
        if (action === 'care-revoke') {
            if(body.inviteId)check(await admin.rpc('petcare_revoke_care_invite',{p_owner:uid,p_id:body.inviteId}));
            if(body.memberId)check(await admin.from('petcare_care_members').delete().eq('owner_id',uid).eq('member_id',body.memberId).eq('pet_id',body.petId));
            return reply({ok:true});
        }
        if (action === 'backups') return reply(check(await admin.rpc('petcare_account_backups',{p_user:uid,p_id:body.id || null})));
        if (action === 'push-health') {
            const logs=check(await admin.from('petcare_push_delivery_log').select('status,last_attempt_at').eq('user_id',uid).gt('last_attempt_at',new Date(Date.now()-7*86400000).toISOString()).limit(1000));
            const devices=check(await admin.from('petcare_push_subscriptions').select('updated_at').eq('user_id',uid));
            return reply({devices:devices.length,accepted:logs.filter((r:any)=>r.status==='sent').length,failed:logs.filter((r:any)=>r.status==='failed').length,lastAttempt:logs.map((r:any)=>r.last_attempt_at).sort().at(-1)||null});
        }
        if (action === 'deleted-documents') return reply(check(await admin.from('petcare_documents').select('id,title,deleted_at,pet_id').eq('user_id',uid).not('deleted_at','is',null).order('deleted_at',{ascending:false})));
        if (action === 'restore-document') { check(await admin.from('petcare_documents').update({deleted_at:null}).eq('user_id',uid).eq('id',body.id)); return reply({ok:true}); }
        if (action === 'export-manifest') {
            const account=await profile();
            const files=check(await admin.rpc('petcare_account_objects',{p_user:uid}));
            const documents=check(await admin.from('petcare_documents').select('*').eq('user_id',uid));
            const pets=check(await admin.from('pets').select('*').eq('user_id',uid));
            const backups=check(await admin.rpc('petcare_account_backups',{p_user:uid,p_id:null}));
            const shares=check(await admin.from('petcare_vet_shares').select('id,pet_id,expires_at,revoked_at,created_at').eq('user_id',uid));
            const memberships=check(await admin.from('petcare_care_members').select('owner_id,pet_id,member_id,created_at').or(`owner_id.eq.${uid},member_id.eq.${uid}`));
            const invites=check(await admin.from('petcare_care_invites').select('id,pet_id,expires_at,revoked_at,used_by,created_at').eq('owner_id',uid));
            const consent=check(await admin.from('petcare_analytics_consent').select('enabled').eq('user_id',uid).maybeSingle());
            const reports=check(await admin.from('petcare_support_reports').select('*').eq('user_id',uid));
            const events=check(await admin.from('petcare_product_events').select('*').eq('user_id',uid));
            const errorEvents=check(await admin.from('petcare_error_events').select('*').eq('user_id',uid));
            return reply({format:'petcare-export-v1',exportedAt:new Date().toISOString(),user:{id:uid,email:auth.user.email},profile:account,documents,pets,backups,shares,memberships,invites,consent,reports,events,errorEvents,files});
        }
        if (action === 'export-file') {
            if(!safeObject(body.bucket,body.path))return reply({error:'invalid_path'},400);
            const files=check(await admin.rpc('petcare_account_objects',{p_user:uid}));
            if(!files.some((file:any)=>file.bucket_id===body.bucket && file.name===body.path))return reply({error:'file_not_found'},404);
            const file=check(await admin.storage.from(body.bucket).download(body.path));
            return new Response(file,{headers:{...headersFor(request),'Content-Type':'application/octet-stream'}});
        }
        if (action === 'trash-files') {
            if(!['petcare-documents','petcare-stories'].includes(body.bucket) || !allowedIds(body.paths,100) || body.paths.some((path:string)=>!safeObject(body.bucket,path)||!path.startsWith(uid+'/')))return reply({error:'invalid_path'},400);
            check(await admin.from('petcare_file_trash').upsert(body.paths.map((path:string)=>({user_id:uid,bucket_id:body.bucket,path})),{onConflict:'user_id,bucket_id,path',ignoreDuplicates:true}));
            return reply({ok:true});
        }
        if (action === 'delete-account') {
            if(body.confirm!=='УДАЛИТЬ' || !auth.user.last_sign_in_at || Date.now()-Date.parse(auth.user.last_sign_in_at)>15*60000)return reply({error:'reauthentication_required'},403);
            let sessionId='';try{const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');sessionId=JSON.parse(atob(part+'='.repeat((4-part.length%4)%4))).session_id||'';}catch{}
            if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId) || !check(await admin.rpc('petcare_recent_session',{p_user:uid,p_session:sessionId})))return reply({error:'reauthentication_required'},403);
            const files=check(await admin.rpc('petcare_account_objects',{p_user:uid}));
            const buckets=new Map<string,string[]>();for(const file of files){if(!buckets.has(file.bucket_id))buckets.set(file.bucket_id,[]);buckets.get(file.bucket_id)!.push(file.name);}
            for(const [bucket,paths] of buckets)for(let offset=0;offset<paths.length;offset+=100)check(await admin.storage.from(bucket).remove(paths.slice(offset,offset+100)));
            check(await admin.auth.admin.signOut(token,'global'));
            check(await admin.auth.admin.deleteUser(uid));
            return reply({ok:true});
        }
        if (action === 'support') {
            const message=String(body.message||'').trim();if(!message || message.length>3000)return reply({error:'invalid_message'},400);
            const id=typeof body.id==='string'&&/^[a-f0-9-]{36}$/i.test(body.id)?body.id:crypto.randomUUID();
            const result=await admin.from('petcare_support_reports').insert({id,user_id:uid,message,diagnostics:safeDiagnostics(body.diagnostics)}).select('id').single();
            if(result.error){const existing=check(await admin.from('petcare_support_reports').select('id').eq('id',id).eq('user_id',uid).maybeSingle());if(existing)return reply(existing);throw new Error('database_error');}
            return reply(result.data);
        }
        if (action === 'analytics-status') return reply(check(await admin.from('petcare_analytics_consent').select('enabled').eq('user_id',uid).maybeSingle()) || {enabled:false});
        if (action === 'analytics-consent') {
            check(await admin.from('petcare_analytics_consent').upsert({user_id:uid,enabled:body.enabled===true}));
            if(body.enabled!==true)check(await admin.from('petcare_product_events').delete().eq('user_id',uid));
            if(body.enabled!==true)check(await admin.from('petcare_error_events').delete().eq('user_id',uid));
            return reply({ok:true});
        }
        if (action === 'analytics-event') {
            if(!['pet_added','reminder_created','active'].includes(body.event))return reply({error:'invalid_event'},400);
            const consent=check(await admin.from('petcare_analytics_consent').select('enabled').eq('user_id',uid).maybeSingle());
            const day=typeof body.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(body.day)&&Date.parse(body.day)<=Date.now()+86400000&&Date.parse(body.day)>Date.now()-90*86400000?body.day:new Date().toISOString().slice(0,10);
            if(consent?.enabled)check(await admin.from('petcare_product_events').upsert({user_id:uid,event:body.event,day},{onConflict:'user_id,event,day',ignoreDuplicates:true}));
            return reply({ok:true});
        }
        if(action==='client-error'){
            if(!['script_error','unhandled_promise','file_sync_failed','file_list_unavailable','document_conflict','document_deleted','care_conflict','care_access_denied','profile_sync_failed','local_write_failed'].includes(body.code))return reply({error:'invalid_code'},400);
            const consent=check(await admin.from('petcare_analytics_consent').select('enabled').eq('user_id',uid).maybeSingle());
            if(consent?.enabled)check(await admin.from('petcare_error_events').upsert({user_id:uid,code:body.code,day:new Date().toISOString().slice(0,10),version:String(body.version||'').slice(0,50)},{onConflict:'user_id,day,code',ignoreDuplicates:true}));
            return reply({ok:true});
        }
        return reply({error:'unknown_action'},400);
    } catch (error) {
        if(error instanceof SyntaxError)return reply({error:'invalid_json'},400);
        console.error('PetCare platform operation failed', error instanceof Error ? error.name : 'unknown');
        return reply({error:error instanceof Error && error.message==='pet_not_found'?'pet_not_found':'operation_failed'},500);
    }
});
