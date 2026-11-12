const assert=require('node:assert/strict');
module.exports=async({page,context,profiles,uid,base,setAvailable})=>{
 const master=()=>page.locator('#routinePushEnabled'),lead=()=>page.locator('#routinePushMinutes');
 const saved=()=>profiles.get(uid).data.pets.find(p=>p.id==='pet-one');
 const settled=()=>page.waitForFunction(()=>!document.getElementById('routinePushEnabled').disabled);
 assert.equal(await master().isChecked(),false,'Existing pets do not get silently opted in');
 const reminders=JSON.stringify(profiles.get(uid).data.reminders);
 await master().check();await settled();assert.equal(saved().dailyRoutinePush.enabled,true);assert.equal(saved().dailyRoutinePush.minutes,10);assert.equal(saved().dailyRoutine.length,3);
 await lead().selectOption('15');await settled();assert.equal(saved().dailyRoutinePush.minutes,15);
 await page.locator('[data-routine="edit"][data-task-id="walk"]').click();
 await page.locator('#routineTaskPush').uncheck();await page.locator('#routineChecks').fill('2');await page.locator('#routineTime2').fill('21:00');
 await page.locator('#routineSave').click();await page.waitForFunction(()=>!document.getElementById('routineDialog').open);
 assert.equal(saved().dailyRoutine.find(t=>t.id==='walk').pushEnabled,false);
 await page.locator('[data-routine="toggle"][data-task-id="walk"][data-step="2"]').click();
 await page.waitForFunction(()=>!document.querySelector('[data-task-id="walk"][data-step="2"]').disabled);
 const marks=JSON.stringify(profiles.get(uid).data.completedTasks);
 await page.evaluate(async()=>{appData.pets.push({id:'pet-two',name:'Кошка',animal:'🐱'});await saveData();switchPet('pet-two')});
 assert.equal(await master().isChecked(),false);await page.evaluate(()=>switchPet('pet-one'));assert.equal(await master().isChecked(),true);
 await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 setAvailable(false);await context.setOffline(true);await master().uncheck();await settled();
 assert.match(await page.locator('#routineStatus').innerText(),/после синхронизации/);
 await page.reload();await page.waitForFunction(()=>window.PetCareRoutine&&activeUserId);assert.equal(await master().isChecked(),false);
 setAvailable(true);await context.setOffline(false);await page.evaluate(()=>PetCareSync.flush());await page.waitForFunction(()=>PetCareSync.state.phase==='saved');
 assert.equal(saved().dailyRoutinePush.enabled,false);assert.equal(JSON.stringify(profiles.get(uid).data.completedTasks),marks);assert.equal(JSON.stringify(profiles.get(uid).data.reminders),reminders);
 // A failed durable write must restore the previous switch, rather than claim success.
 await page.evaluate(()=>{window.savedRoutineSaveData=saveData;saveData=async()=>{throw Error('synthetic disk full')}});
 await master().click();await settled();assert.equal(await master().isChecked(),false);assert.match(await page.locator('#routineStatus').innerText(),/Не удалось сохранить/);
 await page.evaluate(()=>{saveData=window.savedRoutineSaveData});
 await master().check();await settled();
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Fits '+width);
  const box=await page.locator('#routinePushSettings').boundingBox();assert(box.x>=0&&box.x+box.width<=width);
  await page.locator('#routinePushSettings').screenshot({path:`.tools/routine-push-${width}.png`});
 }
 const second=await context.newPage();await second.goto(base);await second.waitForFunction(()=>window.PetCareRoutine&&activeUserId);assert.equal(await second.locator('#routinePushEnabled').isChecked(),true);assert.equal(await second.locator('#routinePushMinutes').inputValue(),'15');await second.close();
 console.log('PASS: daily push opt-in, lead, per-task opt-out, independent times, marks and reminders preserved, per-pet settings, offline disable/reload/sync, disk failure rollback, second tab and 320/390/1440 layout. Services mocked.');
};
