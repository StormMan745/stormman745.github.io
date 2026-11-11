const assert=require('node:assert/strict');
module.exports=async({page,uid})=>{
  let statusCalls=0,holdStatus=false,pending=[],chats=[];
  await page.route('https://qexiyikdmdbdxgusqnee.supabase.co/functions/v1/petcare-assistant',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, OPTIONS'}});
    const body=route.request().postDataJSON();
    if(body.action==='profile-status'){statusCalls++;if(holdStatus)await new Promise(resolve=>pending.push(resolve));}
    else chats.push(body);
    await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify({profileContext:{source:'account',petId:'pet-one',petName:'Барни',signature:'test-signature-'+statusCalls,availableEntries:14,includedEntries:14,partial:false},...(body.action==='profile-status'?{}:{answer:'Тестовый ответ по актуальным записям'})})}).catch(()=>{});
  });
  await page.evaluate(()=>{showAssistant();return refreshAssistantProfile();});await page.waitForFunction(()=>assistantLive.snapshot?.availableEntries===14);
  const keys=await page.evaluate(()=>{
    const base=JSON.parse(JSON.stringify(appData)),petId=getActivePetKey(),original=getAssistantLocalProfileKey(base,petId),result={};
    for(const collection of ['wellbeingEntries','expenses','foodStocks']){
      const changed=JSON.parse(JSON.stringify(base));changed[collection]=[{id:'new-'+collection,petId,date:'2026-11-11',note:'New',title:'Food',name:'Food',appetite:0,activity:1,mood:2,amountKopecks:100,grams:500,dailyGrams:50}];
      result[collection]=getAssistantLocalProfileKey(changed,petId)!==original;
      changed[collection][0].petId='another-pet';result[collection+'Isolation']=getAssistantLocalProfileKey(changed,petId)===original;
    }
    const changed=JSON.parse(JSON.stringify(base));changed.pet.dailyRoutine=[{id:'walk',name:'Прогулка',time:'08:00',times:['08:00','18:00'],checks:2}];
    result.routine=getAssistantLocalProfileKey(changed,petId)!==original;
    const first=getAssistantLocalProfileKey(changed,petId);changed.pet.dailyRoutine[0].times[1]='19:00';result.routineTime=getAssistantLocalProfileKey(changed,petId)!==first;
    const chat=JSON.parse(JSON.stringify(base));chat.assistantConversation=[{role:'user',content:'Only chat changed'}];result.chatUnchanged=getAssistantLocalProfileKey(chat,petId)===original;
    return result;
  });
  assert(Object.values(keys).every(Boolean),JSON.stringify(keys));
  await page.evaluate(async uid=>{
    await PetCareSync.put('preferences',`documents:${uid}`,{key:`documents:${uid}`,userId:uid,rows:[{id:'doc-a',user_id:uid,pet_id:'pet-one',title:'Новый анализ',category:'analysis',document_date:'2026-11-11',revision:1}]});
    window.dispatchEvent(new Event('petcare:files-changed'));
  },uid);
  const before=statusCalls;await page.waitForFunction(()=>assistantLive.documentKey?.includes('Новый анализ'));await page.waitForTimeout(350);assert(statusCalls>before,'New document invalidates metadata');
  const after=statusCalls;await page.evaluate(()=>window.dispatchEvent(new Event('petcare:files-changed')));await page.waitForTimeout(350);assert.equal(statusCalls,after,'Unchanged file events do not reload the profile');
  holdStatus=true;
  await page.evaluate(async()=>{appData.wellbeingEntries=[{id:'well-new',petId:getActivePetKey(),date:getLocalDateInputValue(),appetite:0,activity:1,mood:2,note:'Новая запись'}];await saveData();});
  await page.waitForFunction(()=>assistantLiveRefresh!==null);
  const ask=async text=>{await page.locator('#assistantQuestion').fill(text);await page.locator('#assistantForm').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>activeAssistantRequest===null);};
  await ask('Какие наблюдения записаны о питомце?');
  assert.equal(chats.length,1,'Background profile refresh must not delay an answer');
  assert.equal(chats[0].petId,'pet-one');assert(!('pet' in chats[0])&&!('userId' in chats[0]),'The client cannot choose another account profile');
  assert.match(await page.locator('#assistantMessages').innerText(),/Тестовый ответ/);
  holdStatus=false;pending.splice(0).forEach(resolve=>resolve());
  await page.evaluate(()=>{
    window.originalAssistantAll=PetCareSync.all;window.originalAssistantFlush=PetCareFiles.flush;window.pendingDocJobs=[];window.docFlushes=0;
    PetCareSync.all=(store,user)=>store==='outbox'?Promise.resolve(pendingDocJobs):originalAssistantAll(store,user);
    PetCareFiles.flush=async()=>{window.docFlushes++;pendingDocJobs=[];};
    pendingDocJobs=[{type:'document-edit',petId:getActivePetKey(),id:'doc-a'}];
  });
  await ask('Какие документы сохранены?');assert.equal(chats.length,2);assert.equal(await page.evaluate(()=>docFlushes),1,'Only pending document changes require a flush');
  await ask('Расскажи о запасе корма');assert.equal(await page.evaluate(()=>docFlushes),1,'No extra flush for unchanged records');
  await page.evaluate(()=>{pendingDocJobs=[{type:'document-delete',petId:getActivePetKey(),id:'doc-a'}];PetCareFiles.flush=async()=>{};});
  const sent=chats.length;await ask('Что изменилось в документах?');assert.equal(chats.length,sent,'Unsent document edits cannot produce a misleading fresh answer');
  assert.match(await page.locator('#assistantMessages').innerText(),/документов пока не отправлены/);
  await page.evaluate(()=>{PetCareSync.all=originalAssistantAll;PetCareFiles.flush=originalAssistantFlush;});
  console.log('PASS: invalidation for every added category, per-pet keys, no chat-only reloads, new document refresh, no background-refresh wait, and pending document sync/conflict handling. Services mocked.');
};
