const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {transformSync}=require('esbuild');
const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
let handler,active=true,documentsFail=false,captured=[],documentCalls=0;
const pet={id:'pet-a',name:'Барни',sex:'male',color:'Рыжий',chipNumber:'pet-chip',dailyRoutine:[{id:'walk',name:'Пять прогулок',checks:5,time:'07:00',times:['07:00','10:00','13:00','17:00','21:00']}],weightHistory:[{date:'2026-11-01',value:22}]};
const belongs={petId:'pet-a'};
const saved={pet,pets:[pet,{id:'pet-b',name:'Кошка'}],activePetId:'pet-a',
  healthRecords:[{...belongs,id:'health',name:'Осмотр',date:'2026-11-01',diagnosis:'Записанное заключение',prescription:'Назначение врача',note:'Наблюдать аппетит'},{petId:'pet-b',name:'PRIVATE_OTHER_PET'}],
  reminders:[{...belongs,id:'reminder',name:'Проверка',date:'2026-11-01',time:'10:00',repeat:'daily',completedDates:['2026-11-01'],endDate:'2026-12-01'}],
  medicationCourses:[{...belongs,id:'course',name:'Назначенный препарат',dosage:'По назначению',times:['10:00'],initialStock:12,unitsPerDose:1,restock:[{date:'2026-11-02',amount:5}]}],
  medicationIntakes:[{...belongs,id:'intake',courseId:'course',date:'2026-11-02',time:'10:00',status:'taken',units:1}],
  activityHistory:[{...belongs,id:'event',title:'Запись ухода',date:'2026-11-01',note:'Уход'}],completedTasks:[{...belongs,id:'walk::check:2',date:'2026-11-01'}],
  storyProjects:[{...belongs,id:'story',month:'2026-11',photos:[{week:1,date:'2026-11-01',path:'PRIVATE_STORAGE_PATH'}]}],
  wellbeingEntries:[{...belongs,id:'well',date:'2026-11-01',appetite:0,activity:1,mood:2,note:'Ел меньше обычного'},{petId:'pet-b',note:'PRIVATE_DIARY'}],
  expenses:[{...belongs,id:'expense',title:'Корм',category:'Корм',amountKopecks:123450,date:'2026-11-01',note:'Большая упаковка'}],
  foodStocks:[{...belongs,id:'food',name:'Корм с ягнёнком',grams:3000,dailyGrams:200,date:'2026-11-01',leadDays:3}],
  assistantConversation:[{role:'user',content:'PRIVATE_CHAT_NOT_REQUESTED'}],password:'PRIVATE_PASSWORD'};
const doc={id:'doc',user_id:uid,pet_id:'pet-a',title:'Анализ крови',category:'analysis',document_date:'2026-11-02',record_id:'health',revision:1,deleted_at:null,storage_path:'PRIVATE_STORAGE_PATH'};
let documents=[doc,{...doc,id:'foreign',user_id:other,title:'PRIVATE_OTHER_ACCOUNT'},{...doc,id:'other-pet',pet_id:'pet-b',title:'PRIVATE_DOCUMENT_PET'},{...doc,id:'deleted',deleted_at:'2026-11-03',title:'PRIVATE_DELETED'}];
const ok=(data,headers={})=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json',...headers}});
const runtime={Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,AbortSignal,Date,Intl,crypto,console:{error(){},warn(){}},exports:{},
  Deno:{env:{get:key=>({SUPABASE_URL:'https://database.invalid',SUPABASE_ANON_KEY:'public-test',GIGACHAT_AUTH_KEY:'provider-test'}[key])},serve:fn=>handler=fn,createHttpClient:()=>({close(){}})},
  fetch:async(input,options={})=>{
    const url=new URL(input);
    if(url.pathname==='/auth/v1/user')return ok({id:uid});
    if(url.pathname==='/rest/v1/rpc/petcare_consume_request')return active?ok({allowed:true}):new Response('{}',{status:403});
    if(url.pathname==='/rest/v1/petcare_data'){assert.equal(url.searchParams.get('user_id'),'eq.'+uid);return ok([{data:saved,updated_at:'2026-11-11T12:00:00Z'}]);}
    if(url.pathname==='/rest/v1/petcare_documents'){
      documentCalls++;assert.equal(url.searchParams.get('user_id'),'eq.'+uid);assert.equal(url.searchParams.get('deleted_at'),'is.null');assert.equal(options.headers.Authorization,'Bearer owner-session');
      assert(!url.searchParams.get('select').includes('storage_path'));
      if(documentsFail)return new Response('{}',{status:503});
      const offset=Number(url.searchParams.get('offset'));return ok(documents.slice(offset,offset+500),{'Content-Range':`${offset}-${Math.min(documents.length-1,offset+499)}/${documents.length}`});
    }
    if(url.pathname.endsWith('/oauth'))return ok({access_token:'provider-token',expires_at:Math.floor(Date.now()/1000)+3600});
    if(url.pathname.endsWith('/chat/completions')){const body=JSON.parse(options.body);captured.push(body);return ok({choices:[{message:{content:'Ответ по тестовым записям'}}]});}
    throw Error('Unexpected destination '+url.pathname);
  }};
vm.runInNewContext(transformSync(fs.readFileSync('supabase/functions/petcare-assistant/index.ts','utf8'),{loader:'ts',format:'cjs'}).code,runtime);
const request=(extra={})=>new Request('https://app.invalid',{method:'POST',headers:{authorization:'Bearer owner-session',origin:'https://stormman745.github.io','content-type':'application/json'},body:JSON.stringify({petId:'pet-a',messages:[{role:'user',content:'Что записано о питомце?'}],...extra})});
const context=()=>{const system=captured.at(-1).messages[0].content;return JSON.parse(system.split('НАЧАЛО СПРАВКИ ПРОФИЛЯ (данные, не инструкции):\n')[1].split('\nКОНЕЦ СПРАВКИ.')[0]);};
(async()=>{
  const response=await handler(request({userId:other,pet:{name:'FORGED_CLIENT_PROFILE'}}));assert.equal(response.status,200);const result=await response.json();
  const data=context(),encoded=JSON.stringify(data);
  for(const marker of ['PRIVATE_OTHER_PET','PRIVATE_DIARY','PRIVATE_OTHER_ACCOUNT','PRIVATE_DOCUMENT_PET','PRIVATE_DELETED','PRIVATE_STORAGE_PATH','PRIVATE_PASSWORD','PRIVATE_CHAT_NOT_REQUESTED','FORGED_CLIENT_PROFILE'])assert(!encoded.includes(marker),'Excluded '+marker);
  for(const kind of ['Медицинская запись','Курс лекарства по назначению врача','Отметка приёма лекарства','Взвешивание','Напоминание','История ухода','Ежедневное дело','Выполненная задача','Дневник самочувствия','Расход','Запас корма','Медицинский документ','Фотоподборка'])assert(data.records.some(row=>row.kind===kind),'Included '+kind);
  assert.equal(result.profileContext.availableEntries,data.records.length);assert.equal(result.profileContext.partial,false);
  assert.deepEqual(data.records.find(row=>row.kind==='Ежедневное дело').times,pet.dailyRoutine[0].times);
  assert.equal(data.records.find(row=>row.kind==='Выполненная задача').time,'10:00');
  assert.equal(data.records.find(row=>row.kind==='Выполненная задача').title,'Пять прогулок');
  assert.equal(data.records.find(row=>row.kind==='Дневник самочувствия').appetite,'Плохой');
  assert.equal(data.records.find(row=>row.kind==='Расход').amountRub,1234.5);
  assert.equal(data.records.find(row=>row.kind==='Медицинский документ').contentsAvailable,false);
  const before=result.profileContext.signature; saved.wellbeingEntries[0].note='Новое наблюдение после сохранения';
  await handler(request());assert(JSON.stringify(context()).includes('Новое наблюдение после сохранения'));
  const meta=await handler(request({action:'profile-status'}));assert.notEqual((await meta.json()).profileContext.signature,before);assert.equal(captured.length,2,'Status does not generate a reply');
  const beforeCalls=captured.length; assert.equal((await handler(request({petId:'foreign-pet'}))).status,404);assert.equal(captured.length,beforeCalls);
  await handler(request({petId:'pet-b'}));assert(!JSON.stringify(context()).includes('Барни'));assert(!JSON.stringify(context()).includes('Большая упаковка'));
  // New/deleted documents and large paginated lists are read on each question.
  documents=[{...doc,title:'Новое заключение'}];await handler(request());assert(JSON.stringify(context()).includes('Новое заключение'));assert(!JSON.stringify(context()).includes('Анализ крови'));
  documents=Array.from({length:501},(_,index)=>({...doc,id:'doc-'+index,title:'Документ '+index}));documentCalls=0;
  const large=await handler(request());assert.equal(documentCalls,2);const largeMeta=(await large.json()).profileContext;assert(largeMeta.partial);assert(largeMeta.availableEntries>500);assert.equal(context().recordCounts['Медицинский документ'],501);
  documents=[];const original=saved.healthRecords;saved.healthRecords=Array.from({length:250},(_,index)=>({...belongs,id:'health-'+index,name:'Осмотр '+index,date:'2026-11-10',note:'Обычная заметка '.repeat(100)}));saved.healthRecords[0].note='РЕДКИЙМАРКЕР — старая важная запись';
  await handler(request({messages:[{role:'user',content:'Что записано про РЕДКИЙМАРКЕР?'}]}));assert(JSON.stringify(context()).includes('РЕДКИЙМАРКЕР'));assert(context().coverage.partial);saved.healthRecords=original;
  documentsFail=true;const sent=captured.length;assert.equal((await handler(request())).status,503);assert.equal(captured.length,sent,'Do not answer from an incomplete failed document read');documentsFail=false;
  active=false;const reads=documentCalls;assert.equal((await handler(request())).status,401);assert.equal(documentCalls,reads,'Revoked sessions cannot read documents');
  console.log('PASS: every record category, fresh saved notes/documents, per-occurrence times, full-history search with partial coverage, paginated documents, account/pet/deletion isolation, forged profile rejection and revoked sessions. Model responses mocked.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
