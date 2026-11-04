const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../.tools/preview/node_modules/playwright');
const uid='a3000000-0000-4000-8000-000000000001',other='b3000000-0000-4000-8000-000000000002';
const user=id=>({id,aud:'authenticated',role:'authenticated',email:id===uid?'owner@example.test':'other@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()});
const token=id=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,session_id:'c3000000-0000-4000-8000-000000000003'})).toString('base64url'),Buffer.from('test-only-signature').toString('base64url')].join('.');
const session=id=>({access_token:token(id),refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:user(id)});
const initial=()=>({pet:{id:'pet-one',name:'Барни',animal:'🐶'},pets:[{id:'pet-one',name:'Барни',animal:'🐶'}],activePetId:'pet-one',healthRecords:[],reminders:[],completedTasks:[],activityHistory:[],assistantConversation:[],storyProjects:[],legacyPetsImported:true,preferences:{onboardingDismissed:true}});
function zipEntries(buffer){const result=[];let cursor=0;while(buffer.readUInt32LE(cursor)===0x04034b50){const size=buffer.readUInt32LE(cursor+18),length=buffer.readUInt16LE(cursor+26),extra=buffer.readUInt16LE(cursor+28),name=buffer.subarray(cursor+30,cursor+30+length).toString('utf8'),start=cursor+30+length+extra;result.push({name,bytes:buffer.subarray(start,start+size)});cursor=start+size;}assert.equal(buffer.readUInt32LE(cursor),0x02014b50);return result;}
(async()=>{
 const root=path.resolve(__dirname,'..'),profiles=new Map([[uid,{data:initial(),revision:1}],[other,{data:{...initial(),pets:[{id:'pet-other',name:'Other private'}],pet:{id:'pet-other',name:'Other private'},activePetId:'pet-other'},revision:1}]]),documents=[],objects=new Map(),reports=[],events=[];
 let available=true,consent=false,deleted=false,holdSync=false,releaseSync=null,recoveryRequests=0;
 const sharedMembers=[{owner_id:other,member_id:uid,pet_id:'pet-other'}];
 profiles.get(other).data.pets.push({id:'pet-b-private',name:'Never shared'});
 profiles.get(other).data.healthRecords=[{id:'b-allowed',petId:'pet-other',name:'Shared visit',date:'2026-11-04'},{id:'b-private',petId:'pet-b-private',name:'Never shared visit',date:'2026-11-04'}];
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(error,bytes)=>{if(error)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});res.end(bytes)})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Moscow'}),errors=[];
  context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  await context.addInitScript(({auth,uid})=>{try{if(!localStorage.getItem('test-seeded')){localStorage.setItem('sb-qexiyikdmdbdxgusqnee-auth-token',JSON.stringify(auth));localStorage.setItem('test-seeded','yes');}}catch{}window.print=()=>{window.testPrintCalls=(window.testPrintCalls||0)+1};},{auth:session(uid),uid});
  await context.route('https://qexiyikdmdbdxgusqnee.supabase.co/**',async route=>{
   if(!available)return route.abort('internetdisconnected');
   const request=route.request(),url=new URL(request.url()),method=request.method();
   const reply=(data,status=200,headers={})=>route.fulfill({status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*',...headers},body:data==null?'':JSON.stringify(data)});
   if(method==='OPTIONS')return reply(null,204,{'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, PUT'});
   let actor=uid;try{actor=JSON.parse(Buffer.from(request.headers().authorization.split(' ')[1].split('.')[1],'base64url')).sub}catch{}
   let body={};try{body=request.postDataJSON()||{}}catch{}
   if(url.pathname==='/auth/v1/user')return reply(user(actor));
   if(url.pathname==='/auth/v1/token')return reply({...session(actor)});
   if(url.pathname==='/auth/v1/logout')return reply(null,204);
   if(url.pathname==='/auth/v1/recover'){recoveryRequests++;return reply({});}
   if(url.pathname==='/auth/v1/signup')return reply(session('c3000000-0000-4000-8000-000000000003'));
   if(url.pathname==='/rest/v1/rpc/petcare_sync_profile'){
    if(holdSync){holdSync=false;await new Promise(resolve=>{releaseSync=resolve;});}
    const old=profiles.get(actor)||{data:{},revision:0};if(old.revision!==body.p_revision)return reply({...old,conflict:true});
    const next={data:body.p_data,revision:old.revision+1};profiles.set(actor,next);return reply({...next,conflict:false});
   }
   if(url.pathname==='/rest/v1/rpc/petcare_care_profile'){
    if(!sharedMembers.some(m=>m.owner_id===body.p_owner&&m.member_id===actor&&m.pet_id===body.p_pet))return reply({code:'42501',message:'Access denied'},403);
    const profile=profiles.get(body.p_owner);
    if(body.p_data){if(profile.revision!==body.p_revision)return reply({conflict:true,revision:profile.revision});const next=body.p_data;profile.data.pets=profile.data.pets.map(p=>p.id===body.p_pet?next.pet:p);if(profile.data.activePetId===body.p_pet)profile.data.pet=next.pet;for(const key of ['healthRecords','reminders','medicationCourses','medicationIntakes'])profile.data[key]=[...(profile.data[key]||[]).filter(r=>r.petId!==body.p_pet),...(next[key]||[])];profile.revision++;}
    const data={pet:profile.data.pets.find(p=>p.id===body.p_pet)};for(const key of ['healthRecords','reminders','medicationCourses','medicationIntakes'])data[key]=(profile.data[key]||[]).filter(r=>r.petId===body.p_pet);return reply({conflict:false,data,revision:profile.revision});
   }
   if(url.pathname==='/rest/v1/petcare_data')return reply(profiles.has(actor)?[profiles.get(actor)]:[]);
   if(url.pathname==='/rest/v1/petcare_documents'){
    const id=url.searchParams.get('id')?.replace('eq.',''),pet=url.searchParams.get('pet_id')?.replace('eq.','');
    const matches=r=>r.user_id===actor&&(!id||r.id===id)&&(!pet||r.pet_id===pet);
    if(method==='POST'){const rows=Array.isArray(body)?body:[body];for(const row of rows)if(!documents.some(r=>r.id===row.id))documents.push({...row,revision:1,deleted_at:null});return reply(rows,201);}
    if(method==='PATCH'){const revision=url.searchParams.get('revision')?.replace('eq.','');const updated=documents.filter(r=>matches(r)&&(!revision||r.revision===Number(revision))&&(!url.searchParams.has('deleted_at')||r.deleted_at===null));updated.forEach(r=>Object.assign(r,body,{revision:r.revision+1}));return reply(updated);}
    const found=documents.filter(matches);return reply(request.headers().accept?.includes('vnd.pgrst.object')?found[0]||null:found);
   }
   if(url.pathname==='/rest/v1/pets')return reply([]);
   if(url.pathname.startsWith('/rest/v1/rpc/'))return reply(url.pathname.includes('consume')?{allowed:true}:false);
   if(url.pathname.startsWith('/storage/v1/object/')){
    let name=decodeURIComponent(url.pathname.replace('/storage/v1/object/','').replace(/^authenticated\//,''));
    if(method==='POST'){
     let blob=new Blob([request.postDataBuffer()]);if(request.headers()['content-type']?.startsWith('multipart/form-data')){const form=await new Request('http://test.invalid',{method:'POST',headers:{'Content-Type':request.headers()['content-type']},body:request.postDataBuffer()}).formData();for(const item of form.values())if(typeof item!=='string'){blob=item;break;}}
     objects.set(name,Buffer.from(await blob.arrayBuffer()));return reply({Key:name},200);
    }
    if(!objects.has(name))return reply({message:'not found'},404);
    return route.fulfill({status:200,headers:{'Content-Type':name.endsWith('.png')?'image/png':'application/pdf','Access-Control-Allow-Origin':'*'},body:objects.get(name)});
   }
   if(url.pathname==='/functions/v1/petcare-assistant')return reply({profileContext:{source:'account',petId:body.petId,petName:'Барни',availableEntries:0,signature:'revision-'+profiles.get(actor).revision},answer:'Тестовый ответ'});
   if(url.pathname==='/functions/v1/petcare-platform'){
    if(body.action==='analytics-status')return reply({enabled:consent});
    if(body.action==='analytics-consent'){consent=body.enabled;return reply({ok:true});}
    if(body.action==='analytics-event'){events.push(body);return reply({ok:true});}
    if(body.action==='care-list')return reply({memberships:sharedMembers.filter(m=>m.owner_id===actor||m.member_id===actor),invites:[]});
    if(body.action==='share-list')return reply([]);
    if(body.action==='support'){reports.push(body);return reply({id:'test-report'});}
    if(body.action==='export-manifest')return reply({format:'petcare-export-v1',profile:profiles.get(actor),documents,files:[...objects.keys()].map(name=>({bucket_id:name.split('/')[0],name:name.split('/').slice(1).join('/')})),backups:[]});
    if(body.action==='export-file'){const bytes=objects.get(body.bucket+'/'+body.path);return route.fulfill({status:200,headers:{'Content-Type':'application/octet-stream','Access-Control-Allow-Origin':'*'},body:bytes});}
    if(body.action==='backups')return reply([]);
    if(body.action==='deleted-documents')return reply(documents.filter(d=>d.deleted_at));
    if(body.action==='restore-document'){documents.find(d=>d.id===body.id).deleted_at=null;return reply({ok:true});}
    if(body.action==='delete-account'){deleted=true;profiles.delete(actor);return reply({ok:true});}
    if(body.action==='trash-files')return reply({ok:true});
    return reply({error:'unhandled '+body.action},400);
   }
   return reply({error:'unhandled '+url.pathname},404);
  });
  const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);await page.waitForFunction(()=>window.PetCareCare&&activeUserId&&document.getElementById('homePage').style.display==='block');
  await page.waitForFunction(()=>PetCareSync.state.phase==='saved');
  // The visible daily checklist is editable without changing actual push reminders.
  await page.locator('[data-routine="edit"][data-task-id="feeding"]').click();
  await page.locator('#routineName').fill('Завтрак после прогулки');await page.locator('#routineTime').fill('09:30');
  await page.locator('#routineSave').click();await page.waitForFunction(()=>!document.getElementById('routineDialog').open);
  assert.equal(profiles.get(uid).data.pet.dailyRoutine.find(r=>r.id==='feeding').time,'09:30');
  assert.equal(profiles.get(uid).data.reminders.length,0,'Checklist edits must not silently create push reminders');
  await page.locator('[data-routine="toggle"][data-task-id="feeding"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-task="feeding"] .task-complete').getAttribute('aria-pressed')==='true'&&PetCareSync.state.phase==='saved');
  await page.locator('[data-routine="edit"][data-task-id="feeding"]').click();await page.locator('#routineName').fill('Не сохранять');await page.keyboard.press('Escape');
  assert.match(await page.locator('[data-task="feeding"] .task-info').innerText(),/Завтрак после прогулки/);
  await page.locator('[data-routine="edit"][data-task-id="feeding"]').click();await page.locator('#routineTime').fill('10:00');await page.locator('#routineSave').click();await page.waitForFunction(()=>!document.getElementById('routineDialog').open);
  assert.equal(await page.locator('[data-task="feeding"] .task-complete').getAttribute('aria-pressed'),'true','Editing retains completion');
  // Offline edits survive reload; a task with the same ID on another date/pet must survive merging.
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));available=false;await context.setOffline(true);
  await page.locator('[data-routine="add"]').click();await page.locator('#routineName').fill('Игра <img src=x onerror=alert(1)>');await page.locator('#routineTime').fill('19:15');await page.locator('#routineIcon').selectOption('🎾');await page.locator('#routineSave').click();await page.waitForFunction(()=>!document.getElementById('routineDialog').open);
  assert.equal(await page.locator('#dailyTaskList img').count(),0,'Task names must render as text');
  await page.reload();await page.waitForFunction(()=>window.PetCareRoutine&&activeUserId&&document.querySelectorAll('#dailyTaskList .task').length===4);
  assert.match(await page.locator('#dailyTaskList').innerText(),/Игра <img/);
  await page.evaluate(async()=>{appData.completedTasks.push({id:'feeding',date:'2020-01-01',petId:getActivePetKey()});appData.pets.push({id:'pet-two',name:'Кошка',animal:'🐱'});await saveData()});
  profiles.get(uid).data.completedTasks.push({id:'feeding',date:'2020-01-02',petId:'pet-one'},{id:'feeding',date:'2020-01-02',petId:'pet-two'});profiles.get(uid).revision++;
  available=true;await context.setOffline(false);await page.evaluate(()=>PetCareSync.flush());await page.waitForFunction(()=>PetCareSync.state.phase==='saved');
  assert.equal(profiles.get(uid).data.completedTasks.filter(r=>r.id==='feeding').length,4,'Merge retains repeated task IDs across dates and pets');
  await page.evaluate(()=>switchPet('pet-two'));assert.equal(await page.locator('#dailyTaskList .task').count(),3);assert.match(await page.locator('[data-task="feeding"] .task-info').innerText(),/08:00/);
  await page.locator('[data-routine="toggle"][data-task-id="feeding"]').click();await page.waitForFunction(()=>PetCareSync.state.phase==='saved'&&!document.querySelector('[data-routine="toggle"][data-task-id="feeding"]').disabled);
  assert.equal(profiles.get(uid).data.activityHistory.filter(e=>e.kind==='task').length,2,'Both pets keep independent completion histories');
  await page.evaluate(()=>switchPet('pet-one'));assert.equal(await page.locator('#dailyTaskList .task').count(),4);
  await page.locator('#dailyTaskList .task').filter({hasText:'Игра <img'}).locator('[data-routine="edit"]').click();await page.locator('#routineDelete').click();await page.waitForFunction(()=>!document.getElementById('routineDialog').open);assert.equal(await page.locator('#dailyTaskList .task').count(),3);
  await page.locator('[data-routine="edit"][data-task-id="walk"]').click();
  profiles.get(uid).data.pets[0].dailyRoutine.find(r=>r.id==='walk').time='18:45';profiles.get(uid).data.pet=profiles.get(uid).data.pets[0];profiles.get(uid).revision++;
  await page.evaluate(()=>PetCareSync.flush());await page.locator('#routineName').fill('Устаревшая правка');await page.locator('#routineSave').click();assert.match(await page.locator('#routineFormStatus').innerText(),/другом устройстве/);await page.keyboard.press('Escape');
  assert.equal(profiles.get(uid).data.pet.dailyRoutine.find(r=>r.id==='walk').time,'18:45');
  await page.locator('[data-routine="edit"][data-task-id="walk"]').click();await page.locator('#routineName').fill('Не должно сохраниться');
  await page.evaluate(()=>{window.savedSync=PetCareSync.save;PetCareSync.save=async()=>{throw new Error('test disk full')}});await page.locator('#routineSave').click();await page.waitForFunction(()=>document.getElementById('routineFormStatus').textContent.includes('Не удалось сохранить'));assert.equal(await page.evaluate(()=>PetCareRoutine.items().find(r=>r.id==='walk').name),'Прогулка');await page.evaluate(()=>{PetCareSync.save=window.savedSync});await page.keyboard.press('Escape');
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:960});await page.evaluate(()=>showHome());
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Home fits '+width);
   assert(await page.locator('[data-routine="edit"]').first().evaluate(e=>e.scrollWidth<=e.clientWidth&&parseFloat(getComputedStyle(e).fontSize)<=16),'Edit label fits its button');
   await page.screenshot({path:path.join(root,`.tools/polish-home-${width}.png`),fullPage:true});
   await page.locator('[data-routine="edit"]').first().click();assert(await page.locator('#routineDialog').evaluate(e=>e.scrollWidth<=e.clientWidth),'Editor fits '+width);
   await page.screenshot({path:path.join(root,`.tools/polish-editor-${width}.png`)});await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-care="navigation-more"]').click();await page.locator('[data-care="navigation-open"][data-target="nav-profile"]').click();assert.equal(await page.locator('#profilePage').isVisible(),true);assert.equal(await page.locator('#careDialog').isVisible(),false);
  await page.screenshot({path:path.join(root,'.tools/care-profile-mobile.png'),fullPage:true});
  await page.evaluate(()=>PetCareCare.openMedications());await page.locator('[data-care="course-add"]').click();
  const date=await page.evaluate(()=>getLocalDateInputValue());
  await page.locator('#courseName').fill('Назначенный препарат');await page.locator('#courseDose').fill('Дозировка из назначения');await page.locator('#courseTimes').fill('08:00, 20:00');await page.locator('#courseStock').fill('10');await page.locator('#courseUnits').fill('2');await page.locator('#courseUnitName').fill('таблеток');
  assert.deepEqual(await page.locator('#courseForm').evaluate(form=>[...form.querySelectorAll('input,select,textarea')].filter(e=>e.type!=='hidden'&&!e.labels?.length&&!e.getAttribute('aria-label')).map(e=>e.id)),[],'Course fields need accessible labels');
  await page.locator('#courseForm button[type="submit"]').click();await page.waitForFunction(()=>!document.getElementById('careDialog').open);
  assert.equal(profiles.get(uid).data.medicationCourses.length,1);assert.equal(profiles.get(uid).data.reminders.filter(r=>r.courseId).length,2);
  await page.locator('[data-care="dose"][data-status="taken"]').first().click();await page.waitForFunction(()=>document.querySelectorAll('.care-dose')[0]?.querySelector('span')?.textContent==='Принято');assert.equal(await page.evaluate(()=>PetCareCare.stock(appData.medicationCourses[0],appData)),8);
  await page.locator('[data-care="dose"][data-status="skipped"]').nth(1).click();await page.waitForFunction(()=>document.querySelectorAll('.care-dose')[1]?.querySelector('span')?.textContent==='Пропущено');assert.equal(await page.evaluate(()=>PetCareCare.stock(appData.medicationCourses[0],appData)),8);
  assert.equal(profiles.get(uid).data.reminders[0].completedDates[0],date);
  await page.screenshot({path:path.join(root,'.tools/care-medications-mobile.png'),fullPage:true});
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>{const e=document.activeElement;return e!==document.body&&getComputedStyle(e).outlineStyle!=='none'}),'Keyboard focus must be visible');
  assert.equal(events.length,0,'Analytics must be opt-in');
  // Edit while an earlier save is in flight; retain another device's field.
  profiles.get(uid).data.pets[0].breed='Breed from another device';profiles.get(uid).data.pet.breed='Breed from another device';profiles.get(uid).revision++;
  holdSync=true;const firstSend=page.waitForRequest('**/rest/v1/rpc/petcare_sync_profile');
  await page.evaluate(()=>{appData.healthRecords.push({id:'during-send-1',petId:'pet-one',name:'First queued edit',date:getLocalDateInputValue()});window.firstSave=saveData()});await firstSend;
  for(let n=0;!releaseSync&&n<100;n++)await new Promise(r=>setTimeout(r,5));assert(releaseSync);
  await page.evaluate(()=>{appData.healthRecords.push({id:'during-send-2',petId:'pet-one',name:'Second queued edit',date:getLocalDateInputValue()});window.secondSave=saveData()});releaseSync();releaseSync=null;
  await page.evaluate(()=>Promise.all([window.firstSave,window.secondSave]));await page.waitForFunction(()=>PetCareSync.state.phase==='saved');
  assert.equal(profiles.get(uid).data.pets[0].breed,'Breed from another device');assert(profiles.get(uid).data.healthRecords.some(r=>r.id==='during-send-2'));
  // A's in-flight request must remain authenticated as A across an account switch.
  holdSync=true;const oldRequest=page.waitForRequest('**/rest/v1/rpc/petcare_sync_profile');
  await page.evaluate(()=>{appData.healthRecords.push({id:'account-a-only',petId:'pet-one',name:'Only account A',date:getLocalDateInputValue()});window.oldAccountSave=saveData()});await oldRequest;
  for(let n=0;!releaseSync&&n<100;n++)await new Promise(r=>setTimeout(r,5));assert(releaseSync);
  await page.evaluate(auth=>supabaseClient.auth.setSession({access_token:auth.access_token,refresh_token:auth.refresh_token}),session(other));await page.waitForFunction(expected=>activeUserId===expected,other);releaseSync();releaseSync=null;await page.evaluate(()=>window.oldAccountSave);
  assert(!JSON.stringify(profiles.get(other).data).includes('account-a-only'));
  await page.evaluate(auth=>supabaseClient.auth.setSession({access_token:auth.access_token,refresh_token:auth.refresh_token}),session(uid));await page.waitForFunction(expected=>activeUserId===expected,uid);await page.waitForFunction(()=>document.getElementById('homePage').style.display==='block');
  await page.evaluate(()=>showAssistant());await page.locator('#assistantQuestion').fill('Тест вопроса о питомце');await page.locator('#assistantForm').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>document.getElementById('assistantMessages').textContent.includes('Тестовый ответ'));
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  // Make real requests unavailable, then edit and upload an original offline.
  available=false;await context.setOffline(true);
  await page.evaluate(async()=>{appData.healthRecords.push({id:'offline-visit',petId:'pet-one',name:'Офлайн запись',date:getLocalDateInputValue(),type:'Ветеринар',note:'Введено без связи'});await saveData();await PetCareDocuments.open();});
  await page.evaluate(()=>{document.getElementById('documentEditor').open=true});
  await page.locator('#documentFile').setInputFiles({name:'Результат.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3FoAAAAASUVORK5CYII=','base64')});
  await page.locator('#documentTitle').fill('Офлайн результат обследования');await page.locator('#documentSave').click();
  await page.waitForFunction(()=>document.querySelectorAll('.document-card').length===1&&!document.getElementById('documentSave').disabled);
  assert.equal(documents.length,0,'Offline file must not pretend to be uploaded');assert(await page.evaluate(()=>PetCareFiles.pending())>0);
  await page.reload();await page.waitForFunction(()=>window.PetCareCare&&activeUserId);
  assert.equal(await page.evaluate(()=>appData.healthRecords.some(r=>r.id==='offline-visit')),true,'Offline reload must retain edits');
  await page.evaluate(()=>PetCareDocuments.open());await page.waitForFunction(()=>document.querySelectorAll('.document-card').length===1);
  const pendingPopup=page.waitForEvent('popup');await page.locator('[data-document-action="print"]').click();const print=await pendingPopup;
  await print.waitForFunction(()=>document.body?.classList.contains('print-ready'));assert.equal(await print.locator('.print-sheet').count(),1);await print.close();
  // A different device adds a record. Reconnect must merge both additions.
  profiles.get(uid).data.healthRecords.push({id:'remote-visit',petId:'pet-one',name:'С другого устройства',date,type:'Ветеринар'});profiles.get(uid).revision++;
  available=true;await context.setOffline(false);await page.evaluate(async()=>{await PetCareSync.flush();await PetCareFiles.flush()});
  await page.waitForFunction(()=>PetCareSync.state.phase==='saved');await page.waitForFunction(async()=>await PetCareFiles.pending()===0);
  assert(profiles.get(uid).data.healthRecords.some(r=>r.id==='offline-visit'));assert(profiles.get(uid).data.healthRecords.some(r=>r.id==='remote-visit'));assert.equal(documents.length,1);assert.equal(objects.size,1);
  // Metadata conflicts require an explicit choice; the original stays intact.
  available=false;await context.setOffline(true);
  await page.evaluate(async()=>{const row=(await PetCareFiles.documentRows())[0];await PetCareFiles.editDocument(row,{title:'Название на устройстве',category:row.category,document_date:row.document_date,record_id:row.record_id??null});});
  documents[0].title='Название с другого устройства';documents[0].revision++;
  available=true;await context.setOffline(false);await page.evaluate(()=>PetCareFiles.flush());
  await page.waitForFunction(async()=>(await PetCareSync.all('outbox',activeUserId)).some(j=>j.type==='document-edit'&&j.conflict));
  await page.evaluate(()=>PetCareDocuments.open());await page.waitForFunction(()=>document.querySelector('[data-document-action="resolve-sync"]'));
  await page.locator('[data-document-action="resolve-sync"]').click();assert(await page.locator('#documentConflictDetails').innerText().then(s=>s.includes('Название на устройстве')&&s.includes('Название с другого устройства')));
  await page.locator('#documentConflictRemote').click();await page.waitForFunction(()=>!document.getElementById('careDialog').open);assert.equal(documents[0].title,'Название с другого устройства');assert.equal(objects.size,1);
  // Invalid files are rejected before entering the durable queue.
  await page.evaluate(()=>{document.getElementById('documentEditor').open=true});
  await page.locator('#documentFile').setInputFiles({name:'bad.pdf',mimeType:'application/pdf',buffer:Buffer.from('<html>bad PDF</html>')});await page.locator('#documentSave').click();await page.waitForFunction(()=>!document.getElementById('documentSave').disabled);assert.match(await page.locator('#documentStatus').innerText(),/не распознан/);
  await page.locator('#documentFile').setInputFiles({name:'huge.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(10*1024*1024+1)});await page.locator('#documentSave').click();await page.waitForFunction(()=>!document.getElementById('documentSave').disabled);assert.match(await page.locator('#documentStatus').innerText(),/до 10 МБ/);assert.equal(documents.length,1);
  await page.evaluate(()=>{document.getElementById('documentEditor').open=false});
  await page.locator('[data-document-action="delete"]').click();await page.waitForFunction(()=>document.querySelectorAll('.document-card').length===0);await page.evaluate(()=>PetCareFiles.flush());assert(documents[0].deleted_at);assert.equal(objects.size,1,'Recoverable deletion keeps the original');
  await page.evaluate(id=>PetCareFiles.platform('restore-document',{id}),documents[0].id);await page.evaluate(()=>PetCareDocuments.open());assert.equal(await page.locator('.document-card').count(),1);
  // Same-field edits conflict rather than silently choosing a device.
  available=false;await context.setOffline(true);await page.evaluate(async()=>{appData.pets[0].name='Имя на устройстве';appData.pet=appData.pets[0];await saveData()});
  profiles.get(uid).data.pets[0].name='Имя на сервере';profiles.get(uid).data.pet=profiles.get(uid).data.pets[0];profiles.get(uid).revision++;
  available=true;await context.setOffline(false);await page.evaluate(()=>PetCareSync.flush());await page.waitForFunction(()=>PetCareSync.state.phase==='conflict');assert.equal(profiles.get(uid).data.pets[0].name,'Имя на сервере');
  await page.locator('#syncStatusBar [data-care="sync-retry"]').click();await page.locator('[data-care="conflict-remote"]').click();await page.waitForFunction(()=>!document.getElementById('careDialog').open);assert.equal(await page.evaluate(()=>appData.pet.name),'Имя на сервере');
  await page.evaluate(()=>PetCareCare.openMembers());await page.locator('[data-care="shared-open"]').click();await page.waitForFunction(()=>document.getElementById('sharedCarePageContent').textContent.includes('Shared visit'));assert(!await page.locator('#sharedCarePageContent').innerText().then(s=>s.includes('Never shared visit')));
  await page.locator('[data-care="shared-pet-edit"]').click();await page.locator('#sharedName').fill('Edited by helper');await page.locator('#sharedEditForm button[type="submit"]').click();await page.waitForFunction(()=>!document.getElementById('careDialog').open);assert.equal(profiles.get(other).data.pet.name,'Edited by helper');assert.equal(profiles.get(other).data.pets.find(p=>p.id==='pet-b-private').name,'Never shared');
  await page.evaluate(()=>PetCareCare.openPrivacy());const download=page.waitForEvent('download');await page.locator('[data-care="export-all"]').click();const archive=await download;const zipBuffer=fs.readFileSync(await archive.path());const entries=zipEntries(zipBuffer);assert(entries.some(e=>e.name==='account.json'));assert(entries.some(e=>e.name.endsWith('original.png')));assert(JSON.parse(entries.find(e=>e.name==='account.json').bytes).profile.data.healthRecords.some(r=>r.id==='offline-visit'));
  await page.locator('[data-care="support"]').first().evaluate(e=>e.click());await page.locator('#careSupportMessage').fill('Тестовое описание проблемы');await page.locator('#careSupportForm button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('supportPageStatus').textContent.includes('test-report'));assert.equal(reports.length,1);assert.deepEqual(Object.keys(reports[0].diagnostics).sort(),['browser','errorCodes','online','pending','version']);assert(!JSON.stringify(reports[0]).includes('Офлайн запись'));
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:900});
   for(const screen of ['Pet','Health','Reminders','Stories','Profile','Assistant']){
    await page.evaluate(screen=>window['show'+screen](),screen);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),screen+' fits '+width);
    if(width!==320)await page.screenshot({path:path.join(root,`.tools/polish-${screen.toLowerCase()}-${width}.png`),fullPage:true});
   }
  }
  await page.evaluate(()=>PetCareCare.openPrivacy());await page.screenshot({path:path.join(root,'.tools/care-privacy-desktop.png'),fullPage:true});
  await page.evaluate(()=>PetCareCare.openPrivacy());await page.locator('[data-care="account-delete"]').click();await page.locator('#deleteAccountPassword').fill('test-password');await page.locator('#deleteAccountPhrase').fill('УДАЛИТЬ');await page.locator('#deleteAccountForm button[type="submit"]').click();await page.waitForFunction(()=>activeUserId===null&&document.getElementById('authMessage').textContent.includes('удалены'));
  assert(deleted);assert.equal(await page.evaluate(uid=>PetCareSync.get('profiles',uid),uid),undefined);assert.equal(profiles.get(other).data.pet.name,'Edited by helper');
  await page.locator('#loginEmail').fill('new@example.test');await page.locator('[data-care="password-recovery"]').click();await page.waitForFunction(()=>document.getElementById('authMessage').textContent.includes('Если аккаунт'));assert.equal(recoveryRequests,1);
  await page.locator('#registerTab').click();await page.locator('#registerEmail').fill('new@example.test');await page.locator('#registerPassword').fill('test-password');await page.locator('#registerPassword2').fill('test-password');await page.locator('#registerButton').click();await page.waitForFunction(()=>activeUserId==='c3000000-0000-4000-8000-000000000003'&&document.getElementById('homePage').style.display==='block');assert.equal(await page.evaluate(()=>appData.pet.isPlaceholder),true,'New accounts must not invent a pet');
  assert.deepEqual(errors,[]);console.log('PASS: editable per-pet daily routines, offline edit/reload, completion date/pet merge, stale-editor and storage-failure handling, seven responsive screens, mobile navigation, labeled forms and focus, medication course/daily doses/stock, concurrent saves and account switching, offline upload/reload/printing, profile/document conflicts, recoverable deletion, full shared-care editing isolation, originals ZIP, private diagnostics, opt-out, account deletion, registration and password recovery (mocked services).');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
