import { createClient } from '@supabase/supabase-js';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default,
 {auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; sandbox",'X-Frame-Options':'DENY',...(status===429?{'Retry-After':'60'}:{})}});
function text(value:unknown,max:number,required=false){
 if(value===undefined||value===null){if(required)throw Error('invalid_record');return '';}
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('invalid_record');
 const result=value.trim();if(required&&!result)throw Error('invalid_record');return result;
}
function normalize(body:any){
 if(!body||typeof body!=='object'||Array.isArray(body)||!body.record||typeof body.record!=='object'||Array.isArray(body.record))throw Error('invalid_record');
 const event=text(body.eventId,160,true),r=body.record,date=text(r.date,10,true);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('invalid_record');
 if(!['visit','examination'].includes(r.kind))throw Error('invalid_record');
 const results=text(r.results,16000,r.kind==='examination');
 const doctor=text(r.doctor,160),note=text(r.note,16000);
 return {event,record:{type:r.kind==='examination'?'Анализы':'Ветеринар',name:text(r.name,160,true),date,
  note:[doctor?`Врач: ${doctor}`:'',note].filter(Boolean).join('\n'),diagnosis:text(r.diagnosis,4000),prescription:text(r.prescription,8000),
  labName:r.kind==='examination'?text(r.labName,160):'',labResult:results}};
}
Deno.serve(async request=>{
 if(request.headers.has('origin'))return reply({error:'server_to_server_only'},403);
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
 if(!/^pc_clinic_[A-Za-z0-9_-]{43}$/.test(token))return reply({error:'connection_unavailable'},401);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return reply({error:'json_required'},415);
 try{
  const parts:Uint8Array[]=[];let size=0;const reader=request.body?.getReader();
  if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return reply({error:'request_too_large'},413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply({error:'invalid_record'},400);}
  const {event,record}=normalize(body);
  const result=await admin.rpc('petcare_clinic_receive',{p_hash:await hash(token),p_event:event,p_payload_hash:await hash(JSON.stringify(record)),p_record:record});
  if(result.error){if(['22023','23514','22007','22008'].includes(result.error.code))return reply({error:'profile_limit_or_invalid_record'},422);return reply({error:'temporarily_unavailable'},503);}
  const data=result.data;
  if(data?.error){const status=({connection_unavailable:404,rate_limited:429,event_conflict:409,invalid_record:400,profile_limit_or_invalid_record:422} as Record<string,number>)[data.error]||503;return reply({error:data.error},status);}
  if(data?.accepted!==true)return reply({error:'temporarily_unavailable'},503);
  return reply({accepted:true,duplicate:!!data.duplicate,recordId:data.recordId});
 }catch(error){return reply({error:error instanceof Error&&error.message==='invalid_record'?'invalid_record':'temporarily_unavailable'},error instanceof Error&&error.message==='invalid_record'?400:503);}
});
