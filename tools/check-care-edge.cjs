const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {transformSync}=require('esbuild');
const uid='a4000000-0000-4000-8000-000000000001',other='b4000000-0000-4000-8000-000000000002';
const token='a'.repeat(43),otherToken='b'.repeat(43),digest=s=>require('crypto').createHash('sha256').update(s).digest('hex');
const now=()=>new Date().toISOString();
const tables={petcare_data:[{user_id:uid,data:{pets:[{id:'pet-a',name:'Alice pet'},{id:'pet-private',name:'Private second pet'}],healthRecords:[{id:'h1',petId:'pet-a',name:'Allowed visit'},{id:'h2',petId:'pet-private',name:'Private visit'}],assistantConversation:[{content:'PRIVATE CHAT'}]},revision:1}],
 petcare_vet_shares:[{id:'share-a',user_id:uid,pet_id:'pet-a',token_hash:digest(token),snapshot:{pet:{name:'Allowed pet'},healthRecords:[{name:'Selected visit'}]},document_ids:['doc-a'],expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:null}],
 petcare_documents:[{id:'doc-a',user_id:uid,pet_id:'pet-a',title:'Selected PDF',file_name:'result.pdf',mime_type:'application/pdf',file_size:12,storage_path:uid+'/doc-a/original.pdf',deleted_at:null},{id:'doc-b',user_id:other,pet_id:'pet-b',title:'Private other PDF',file_name:'private.pdf',mime_type:'application/pdf',storage_path:other+'/doc-b/original.pdf',deleted_at:null}],
 petcare_care_members:[],petcare_care_invites:[],petcare_support_reports:[],petcare_analytics_consent:[],petcare_product_events:[],petcare_file_trash:[],pets:[]};
const credential=alias=>['e30',Buffer.from(JSON.stringify({sub:alias==='alice'?uid:other,session_id:'c4000000-0000-4000-8000-000000000003'})).toString('base64url'),'c2ln'].join('.');
let authCalls=0,downloads=[],removals=[],signouts=[],deletions=[],recent=true,quota=true,rpcs=[];
function query(table){let op='select',payload,projection='*',single=false,filters=[],count=10000;const q={
 select(fields='*'){projection=fields;return q},eq:(key,value)=>(filters.push(row=>row[key]===value),q),is:(key,value)=>(filters.push(row=>row[key]===value),q),
 gt:(key,value)=>(filters.push(row=>row[key]>value),q),lt:(key,value)=>(filters.push(row=>row[key]!=null&&row[key]<value),q),
 in:(key,value)=>(filters.push(row=>value.includes(row[key])),q),not:(key,op,value)=>(filters.push(row=>row[key]!=null),q),
 or(){return q},order(){return q},limit(n){count=n;return q},single(){single=true;return q},maybeSingle(){single=true;return q},
 insert(data){op='insert';payload=data;return q},upsert(data){op='insert';payload=data;return q},update(data){op='update';payload=data;return q},delete(){op='delete';return q},
 then(resolve,reject){return Promise.resolve().then(()=>{let rows=tables[table]||[];let matches=rows.filter(row=>filters.every(fn=>fn(row))).slice(0,count);
  if(op==='insert'){matches=(Array.isArray(payload)?payload:[payload]).map(row=>({id:'generated-'+rows.length,created_at:now(),...row}));tables[table]=[...rows,...matches];}
  if(op==='update')matches.forEach(row=>Object.assign(row,payload));if(op==='delete')tables[table]=rows.filter(row=>!matches.includes(row));
  const result=matches.map(row=>projection==='*'?{...row}:Object.fromEntries(projection.split(',').map(key=>[key,row[key]])));
  return {data:single?result[0]||null:result,error:null};}).then(resolve,reject)}
 };return q;}
const admin={auth:{getUser:async jwt=>{authCalls++;const id=jwt===credential('alice')?uid:jwt===credential('bob')?other:null;return id?{data:{user:{id,email:'test@example.invalid',last_sign_in_at:recent?now():'2020-01-01T00:00:00Z'}},error:null}:{data:{user:null},error:{message:'invalid'}}},admin:{signOut:async(jwt,scope)=>{signouts.push([jwt,scope]);return {data:null,error:null}},deleteUser:async id=>{deletions.push(id);return {data:{user:{id}},error:null}}}},
 from:query,rpc:async(name,args)=>{rpcs.push([name,args]);if(name==='petcare_recent_session')return {data:recent,error:null};if(name==='petcare_get_push_runtime_secrets')return {data:{cronToken:'cron-token-012345678901234567890123456789'},error:null};if(name==='petcare_account_objects')return {data:[{bucket_id:'petcare-documents',name:args.p_user+'/doc-a/original.pdf'}],error:null};if(name==='petcare_account_backups')return {data:[],error:null};if(name==='petcare_accept_care')return {data:true,error:null};throw Error('unexpected rpc '+name)},
 storage:{from:bucket=>({
  download:async path=>{downloads.push([bucket,path]);return {data:new Blob(['original bytes']),error:null};},
  remove:async paths=>{removals.push([bucket,paths]);return {data:[],error:null};}
 })}};
let handler;const logs=[];
const runtime={Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,crypto:globalThis.crypto,atob,console:{error:(...args)=>logs.push(args)},exports:{},
 Deno:{env:{get:name=>({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-test-secret'}[name])},serve:fn=>handler=fn},
 require:name=>{assert.equal(name,'@supabase/supabase-js');return {createClient:(_url,key,options)=>key==='server-test-secret'?admin:{rpc:async()=>({data:{allowed:quota,retryAfter:20},error:null})}}}};
vm.runInNewContext(transformSync(fs.readFileSync('supabase/functions/petcare-platform/index.ts','utf8'),{loader:'ts',format:'cjs'}).code,runtime);
const request=(data,jwt='',headers={})=>new Request('https://app.invalid',{method:'POST',headers:{origin:'https://stormman745.github.io',apikey:'public-test-key','content-type':'application/json',...(jwt?{authorization:'Bearer '+credential(jwt)}:{}),...headers},body:typeof data==='string'?data:JSON.stringify(data)});
(async()=>{
 assert.equal((await handler(new Request('https://app.invalid',{method:'PUT'}))).status,405);
 const before=authCalls;assert.equal((await handler(request({action:'backups'},'alice',{origin:'https://evil.invalid'}))).status,403);assert.equal(authCalls,before);
 assert.equal((await handler(request({action:'backups'}))).status,401);
 assert.equal((await handler(request('not json'))).status,400);
 assert.equal((await handler(request({action:'support',message:'x'.repeat(65537)},'alice'))).status,413);
 const view=await handler(request({action:'share-view',token}));assert.equal(view.status,200);const data=await view.json();assert.equal(data.documents.length,1);assert(!('storage_path'in data.documents[0]));assert(!JSON.stringify(data).includes('PRIVATE CHAT'));assert(!JSON.stringify(data).includes(other));assert.equal(view.headers.get('cache-control'),'no-store');
 assert.equal((await handler(request({action:'share-file',token,documentId:'doc-b'}))).status,404);assert.equal(downloads.length,0);
 const file=await handler(request({action:'share-file',token,documentId:'doc-a'}));assert.equal(file.status,200);assert.equal(await file.text(),'original bytes');assert.equal(downloads.length,1);
 tables.petcare_vet_shares[0].revoked_at=now();assert.equal((await handler(request({action:'share-view',token}))).status,404);assert.equal((await handler(request({action:'share-file',token,documentId:'doc-a'}))).status,404);
 tables.petcare_vet_shares[0].revoked_at=null;tables.petcare_vet_shares[0].expires_at='2020-01-01T00:00:00Z';assert.equal((await handler(request({action:'share-view',token}))).status,404);
 assert.equal((await handler(request({action:'share-create',petId:'pet-a',recordIds:['h2'],documentIds:[],tokenHash:digest(otherToken)},'alice'))).status,400);
 assert.equal((await handler(request({action:'export-file',bucket:'petcare-documents',path:other+'/doc-b/original.pdf'},'alice'))).status,404);
 const own=await handler(request({action:'export-file',bucket:'petcare-documents',path:uid+'/doc-a/original.pdf'},'alice'));assert.equal(own.status,200);
 quota=false;assert.equal((await handler(request({action:'backups'},'alice'))).status,429);quota=true;
 assert.equal((await handler(request({action:'support',message:'Problem',diagnostics:{version:'test',browser:'Chrome',online:true,pending:2,errorCodes:['script_error','SECRET QUESTION?'],medicalRecords:['PRIVATE'],email:'PRIVATE'}},'alice'))).status,200);
 const report=tables.petcare_support_reports[0];assert.equal(report.user_id,uid);assert.deepEqual(Object.keys(report.diagnostics).sort(),['browser','errorCodes','online','pending','version']);assert.equal(report.diagnostics.errorCodes.length,1);assert(!JSON.stringify(report).includes('PRIVATE'));
 await handler(request({action:'analytics-event',event:'active',question:'PRIVATE'},'alice'));assert.equal(tables.petcare_product_events.length,0);
 await handler(request({action:'analytics-consent',enabled:true},'alice'));await handler(request({action:'analytics-event',event:'active',question:'PRIVATE'},'alice'));assert.equal(tables.petcare_product_events.length,1);assert.deepEqual(Object.keys(tables.petcare_product_events[0]).sort(),['created_at','day','event','id','user_id']);
 await handler(request({action:'analytics-consent',enabled:false},'alice'));assert.equal(tables.petcare_product_events.length,0);
 const accepted=await handler(request({action:'care-accept',token:otherToken,userId:uid},'bob'));assert.equal(accepted.status,200);assert.equal(rpcs.find(row=>row[0]==='petcare_accept_care')[1].p_user,other);
 assert.equal((await handler(request({action:'delete-account',confirm:'wrong'},'alice'))).status,403);assert.equal(removals.length,0);
 recent=false;assert.equal((await handler(request({action:'delete-account',confirm:'УДАЛИТЬ'},'alice'))).status,403);assert.equal(removals.length,0);recent=true;
 assert.equal((await handler(request({action:'delete-account',confirm:'УДАЛИТЬ',userId:other},'alice'))).status,200);assert.deepEqual(deletions,[uid]);assert.deepEqual(signouts,[[credential('alice'),'global']]);assert(removals.every(([,paths])=>paths.every(path=>path.startsWith(uid+'/'))));
 assert.equal((await handler(request({action:'maintenance'}))).status,401);
 assert(!JSON.stringify(logs).includes('PRIVATE'));
 console.log('PASS: platform authorization, CORS/body bounds, expiring/revoked vet token and file scope, export IDOR prevention, quota, diagnostics whitelist, opt-in analytics, bound invite identity, recent-login deletion and own-only originals. All external APIs mocked.');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
