const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{transformSync}=require('esbuild');
let handler,code=null,error=null,calls=[];const token='pc_clinic_'+'a'.repeat(43);
const runtime={Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,Date,crypto,console:{error(){}},exports:{},
 Deno:{env:{get:n=>({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-secret'}[n])},serve:fn=>handler=fn},
 require:()=>({createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:code?{error:code}:{accepted:true,recordId:'created',duplicate:false},error}}})})};
vm.runInNewContext(transformSync(fs.readFileSync('supabase/functions/petcare-clinic-sync/index.ts','utf8'),{loader:'ts',format:'cjs'}).code,runtime);
const visit={eventId:'external-visit-1',record:{kind:'visit',name:'Приём',date:'2026-11-12',note:'Заключение',doctor:'Врач',diagnosis:'Из медкарты'}};
const request=(body=visit,headers={})=>new Request('https://edge.invalid',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
(async()=>{
 assert.equal((await handler(new Request('https://edge.invalid'))).status,405);
 assert.equal((await handler(request(visit,{authorization:'Bearer invalid'}))).status,401);
 assert.equal((await handler(request(visit,{origin:'https://evil.invalid'}))).status,403);
 assert.equal((await handler(request(visit,{'content-type':'text/plain'}))).status,415);
 assert.equal((await handler(request('x'.repeat(65537)))).status,413);
 for(const bad of ['{','[]',JSON.stringify({...visit,record:{...visit.record,date:'2026-02-31'}}),JSON.stringify({...visit,record:{...visit.record,kind:'unknown'}}),JSON.stringify({...visit,record:{...visit.record,name:'x'.repeat(161)}}),JSON.stringify({eventId:'test',record:{kind:'examination',name:'Анализ',date:'2026-11-12'}})])assert.equal((await handler(request(bad))).status,400);
 assert.equal(calls.length,0,'Invalid payloads do not reach the database');
 const response=await handler(request({...visit,userId:'other',petId:'other',record:{...visit.record,id:'override',petId:'other',source:{kind:'verified-doctor'}}}));
 assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(calls[0].name,'petcare_clinic_receive');assert.equal(calls[0].args.p_hash,require('node:crypto').createHash('sha256').update(token).digest('hex'));
 assert.equal(calls[0].args.p_record.petId,undefined);assert.equal(calls[0].args.p_record.id,undefined);assert.equal(calls[0].args.p_record.source,undefined);
 assert(!JSON.stringify(calls).includes(token),'Only the token hash reaches RPC');
 await handler(request({eventId:'lab-1',record:{kind:'examination',name:'Обследование',date:'2026-11-12',results:'Показатели лаборатории',labName:'Лаборатория'}}));
 assert.equal(calls.at(-1).args.p_record.type,'Анализы');assert.equal(calls.at(-1).args.p_record.labResult,'Показатели лаборатории');
 for(const [key,status] of Object.entries({connection_unavailable:404,event_conflict:409,rate_limited:429,invalid_record:400})){code=key;const r=await handler(request());assert.equal(r.status,status);if(status===429)assert.equal(r.headers.get('Retry-After'),'60');}
 code=null;error={code:'22023',message:'PRIVATE DATA'};let r=await handler(request());assert.equal(r.status,422);assert(!(await r.text()).includes('PRIVATE'));
 error={code:'XX000',message:'PRIVATE DATA'};r=await handler(request());assert.equal(r.status,503);assert(!(await r.text()).includes('PRIVATE'));
 console.log('PASS: clinic transport authentication, browser origin rejection, body/field/date limits, visit and examination normalization, scope spoofing resistance, hash-only keys, safe errors and rate-limit responses. Database mocked.');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
