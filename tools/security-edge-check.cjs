const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {transformSync}=require('esbuild');
function runtime(file,env,fetcher,requireMock=()=>{}){
 const sandbox={Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,AbortSignal,crypto:globalThis.crypto,console:{warn(){},error(){}},btoa,setTimeout,clearTimeout,require:requireMock,exports:{}};
 sandbox.Deno={env:{get:key=>env[key]},serve:fn=>sandbox.handler=fn,createHttpClient:()=>({close(){}})};
 vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{...sandbox,fetch:fetcher,Deno:sandbox.Deno});
 return (...args)=>sandbox.handler(...args);
}
const ok=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const uid='00000000-0000-4000-8000-000000000001';
(async()=>{
 const calls=[];let quota=true,auth=true;
 const assistant=runtime('supabase/functions/petcare-assistant/index.ts',{SUPABASE_URL:'https://database.invalid',SUPABASE_ANON_KEY:'test-key',GIGACHAT_AUTH_KEY:'test-provider-key'},async(input,options={})=>{
  const url=String(input);calls.push(url);
  if(url.endsWith('/auth/v1/user'))return auth?ok({id:uid}):new Response('{}',{status:401});
  if(url.endsWith('/rpc/petcare_consume_request'))return ok({allowed:quota,retryAfter:30});
  if(url.includes('/rest/v1/petcare_data')){assert.equal(new URL(url).searchParams.get('user_id'),'eq.'+uid);return ok([{data:{pet:{id:'pet-a',name:'Test pet'},pets:[{id:'pet-a',name:'Test pet'}],healthRecords:[]},updated_at:'2026-10-30T00:00:00Z'}]);}
  if(url.includes('/oauth'))return ok({access_token:'test-access-token',expires_at:Math.floor(Date.now()/1000)+1800});
  if(url.includes('/chat/completions'))return ok({choices:[{message:{content:'Test answer'}}]});
  throw Error('Unexpected destination '+url);
 });
 const request=(body,headers={})=>new Request('https://app.invalid',{method:'POST',headers:{origin:'https://stormman745.github.io',authorization:'Bearer test-token','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 const question={messages:[{role:'user',content:'Test question'}],petId:'pet-a'};
 assert.equal((await assistant(request(question))).status,200);
 calls.length=0;quota=false;
 const limited=await assistant(request(question));assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'30');assert(!calls.some(x=>x.includes('petcare_data')||x.includes('giga.chat')));
 quota=true;auth=false;calls.length=0;assert.equal((await assistant(request(question))).status,401);assert.equal(calls.length,1);
 auth=true;calls.length=0;assert.equal((await assistant(request(question,{origin:'https://untrusted.invalid'}))).status,403);assert.equal(calls.length,0);
 assert.equal((await assistant(request(question,{'content-type':'text/plain'}))).status,415);
 assert.equal((await assistant(request(JSON.stringify({message:'x'.repeat(65537)})))).status,413);
 assert.equal((await assistant(request({...question,petId:'another-account-pet'}))).status,404);
 calls.length=0;assert.equal((await assistant(request({action:'profile-status',petId:'pet-a'}))).status,200);assert(!calls.some(x=>x.includes('giga.chat')));
 let sends=0,rpcs=0;
 const cronToken='test-cron-token-012345678901234567890';
 const now=new Date(),date=now.toISOString().slice(0,10),time=now.toISOString().slice(11,16);
 const endpoints=['https://fcm.googleapis.com/fcm/send/test','https://127.0.0.1/private','https://169.254.169.254/latest','https://fcm.googleapis.com.evil.invalid/x','https://fcm.googleapis.com@evil.invalid/x'];
 const devices=endpoints.map(endpoint=>({user_id:uid,endpoint,subscription:{endpoint,keys:{p256dh:'test',auth:'test'}},timezone_name:'UTC'}));
 const admin={rpc:async name=>{rpcs++;return {data:name==='petcare_get_push_runtime_secrets'?{cronToken,vapid:{subject:'mailto:test@example.invalid',publicKey:'public',privateKey:'private'}}:[{user_id:uid,pet:{id:'pet-a',name:'Test'},reminders:[{id:'r1',petId:'pet-a',name:'Test reminder',date,time}]}],error:null};},from:table=>{
  const q={select:()=>q,limit:async()=>({data:devices,error:null}),eq:()=>q,maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null}),update:()=>q,delete:()=>q,then:resolve=>resolve({error:null})};return q;
 }};
 const push=runtime('supabase/functions/petcare-push-reminders/index.ts',{SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-secret'},()=>{throw Error('unexpected fetch');},name=>name==='@supabase/supabase-js'?{createClient:()=>admin}:{sendNotification:async(sub,payload,options)=>{assert.equal(sub.endpoint,endpoints[0]);assert.equal(options.timeout,10000);sends++;}});
 assert.equal((await push(new Request('https://app.invalid',{method:'POST'}))).status,401);assert.equal(rpcs,0);
 const denied=await push(new Request('https://app.invalid',{method:'POST',headers:{'x-petcare-cron-token':'wrong-but-long-enough-token-123456789'}}));assert.equal(denied.status,401);assert.equal(sends,0);
 const dispatched=await push(new Request('https://app.invalid',{method:'POST',headers:{'x-petcare-cron-token':cronToken}}));assert.equal(dispatched.status,200);assert.equal(sends,1);
 console.log(JSON.stringify({assistant:'auth, quotas, body limit, origins, own-profile selection and normal reply passed',push:'cron authorization and outbound endpoint restrictions passed; notifications mocked'}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
