const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async({page,context,profiles,uid,other,documents,collars,base,session,setAvailable})=>{
 const open=kind=>page.evaluate(kind=>PetCareExtras.open(kind),kind),form=()=>page.locator('#extrasDialog form'),done=()=>page.waitForFunction(()=>!document.getElementById('extrasDialog').open);
 const save=async()=>{await form().locator('button[type=submit]').click();try{await done();}catch(e){console.log(await page.locator('#extrasFormStatus').innerText());console.log(await form().evaluate(f=>[...f.elements].filter(x=>x.validity&&!x.validity.valid).map(x=>({id:x.id,message:x.validationMessage}))));throw e;}};
 const click=label=>page.getByRole('button',{name:label,exact:true}).click();
 await page.evaluate(async()=>{appData.pets.push({id:'pet-two',name:'Кошка',animal:'🐱'});await saveData()});
 await open('wellbeing');await click('Отметить сегодня');
 for(const [name,value] of [['appetite','1'],['activity','2'],['mood','2']])await page.locator(`input[name=${name}][value="${value}"]`).check();
 await page.locator('#wellNote').fill('<img src=x onerror=alert(1)> Играла и гуляла');await save();
 assert.equal(profiles.get(uid).data.wellbeingEntries.length,1);assert.equal(await page.locator('details[open]').count(),0);
 await page.locator('#extrasContent summary').click();await page.locator('#extrasContent .extras-record').first().waitFor();assert(await page.locator('#extrasContent').innerText().then(s=>s.includes('<img')));assert.equal(await page.locator('#extrasContent img').count(),0,'Untrusted diary text stays text');
 await page.evaluate(()=>switchPet('pet-two'));await open('wellbeing');assert.equal(await page.getByRole('button',{name:'Отметить сегодня',exact:true}).count(),1);
 await page.evaluate(()=>switchPet('pet-one'));await open('supplies');
 async function expense(amount,title){await click('＋ Добавить расход');await page.locator('#expenseTitle').fill(title);await page.locator('#expenseAmount').fill(amount);await save();}
 await expense('0.10','Корм');await expense('0,20','Корм тест');assert.equal(await page.locator('.extras-total').innerText(),'0,30 ₽');
 assert.equal(profiles.get(uid).data.expenses.reduce((n,r)=>n+r.amountKopecks,0),30,'Integer kopecks avoid rounding drift');
 await page.locator('#expenseMonth').fill('2025-01');assert.equal(await page.locator('.extras-total').innerText(),'0,00 ₽');await page.locator('#expenseMonth').fill(await page.evaluate(()=>getLocalDateInputValue().slice(0,7)));
 await click('Запас корма');await click('Добавить запас');await page.locator('#foodName').fill('Сухой корм');await page.locator('#foodAmount').fill('2');await page.locator('#foodDaily').fill('250');await page.locator('#foodLead').fill('3');await save();
 assert.match(await page.locator('#extrasContent').innerText(),/на 8 дн/);
 assert.deepEqual(await page.evaluate(()=>PetCareExtras.foodEstimate({date:'2026-10-24',grams:2000,dailyGrams:250,leadDays:3},'2026-10-26')),{remaining:1500,daysLeft:6,buyDate:'2026-10-29'});
 assert.equal(await page.evaluate(()=>PetCareExtras.foodEstimate({date:'2026-10-24',grams:2000,dailyGrams:250,leadDays:3},'2026-12-01').remaining),0);
 // New collections reuse the same durable offline store and account merge.
 setAvailable(false);await context.setOffline(true);await click('Уточнить / пополнить запас');await page.locator('#foodAmount').fill('3');await save();await page.reload();await page.waitForFunction(()=>window.PetCareExtras&&activeUserId);
 assert.equal(await page.evaluate(()=>appData.foodStocks[0].grams),3000);assert.equal(await page.evaluate(()=>appData.expenses.length),2);assert.equal(await page.evaluate(()=>appData.wellbeingEntries.length),1);
 setAvailable(true);await context.setOffline(false);await page.evaluate(()=>PetCareSync.flush());await page.waitForFunction(()=>PetCareSync.state.phase==='saved');assert.equal(profiles.get(uid).data.foodStocks[0].grams,3000);
 documents.push({id:'doc-search',user_id:uid,pet_id:'pet-one',title:'Анализ крови',file_name:'analysis.pdf',category:'Анализ',deleted_at:null},{id:'doc-other',user_id:other,pet_id:'pet-one',title:'PRIVATE SECRET',deleted_at:null});
 await page.evaluate(async()=>{appData.healthRecords.push({id:'health-search',petId:'pet-one',name:'Анализ на приёме',note:'контроль'});appData.medicationCourses=[{id:'course-search',petId:'pet-one',name:'Назначение',dosage:'По назначению',instructions:'После анализа'}];await saveData();});
 await open('search');await page.locator('#extrasQuery').fill('анализ');await page.waitForFunction(()=>document.querySelectorAll('.extras-result').length===3);assert(!await page.locator('#extrasContent').innerText().then(s=>s.includes('PRIVATE SECRET')));
 await page.locator('.extras-result').filter({hasText:'Анализ крови'}).click();assert(await page.locator('#extrasDialogContent').innerText().then(s=>s.includes('analysis.pdf')));await page.keyboard.press('Escape');
 await page.evaluate(()=>showAssistant());await page.locator('#assistantQuestion').fill('Напомни о прививке завтра в 10:00');await page.locator('#assistantForm').evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>document.querySelector('.extras-chat-draft'));
 assert.equal(await page.evaluate(()=>appData.reminders.length),0,'A chat suggestion never performs the action');
 await click('Проверить и подтвердить');assert.equal(await page.locator('#draftTime').inputValue(),'10:00');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>appData.reminders.length),0);
 await click('Проверить и подтвердить');await save();assert.equal(await page.evaluate(()=>appData.reminders.length),1);assert.match(await page.locator('.extras-chat-draft').innerText(),/создано/);
 await page.reload();await page.waitForFunction(()=>window.PetCareExtras&&activeUserId);await page.evaluate(()=>showAssistant());assert.match(await page.locator('.extras-chat-draft').innerText(),/создано/);
 assert.equal(await page.evaluate(()=>PetCareExtras.reminderDraft('Не добавляй напоминание о корме')),null);
 await open('collar');await page.getByRole('button',{name:'Создать карточку',exact:true}).waitFor();await click('Создать карточку');await page.locator('#tagContact').fill('+7 900 123-45-67');await page.locator('#tagConsent').check();
 await page.locator('#tagPhoto').setInputFiles({name:'pet.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3FoAAAAASUVORK5CYII=','base64')});await page.waitForFunction(()=>document.querySelector('.extras-tag-photo').src.startsWith('data:image/jpeg'));
 await save();assert.equal(collars.length,1);assert.deepEqual(Object.keys(collars[0].card).sort(),['contact','kind','name','photo']);
 const download=page.waitForEvent('download');await click('Скачать QR-карточку PNG');const file=await download;await file.saveAs(path.resolve('.tools/collar-download.png'));
 const link=await page.locator('.extras-tag-preview a').getAttribute('href');assert.match(link,/collar.html#[A-Za-z0-9_-]{43}$/);
 const publicPage=await context.newPage();await publicPage.goto(base+'/collar.html#'+link.split('#')[1]);await publicPage.locator('a.contact').waitFor();assert.equal(await publicPage.locator('h1').innerText(),'Барни');assert.equal(await publicPage.locator('a.contact').getAttribute('href'),'tel:+79001234567');
 assert(!await publicPage.locator('body').innerText().then(s=>s.includes('анализ')||s.includes('PRIVATE')));
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});for(const kind of ['wellbeing','supplies','search','collar']){await open(kind);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),kind+' fits '+width);await page.screenshot({path:path.resolve(`.tools/extras-${kind}-${width}.png`),fullPage:true});}}
 await page.getByRole('button',{name:'Отключить карточку',exact:true}).waitFor();await click('Отключить карточку');await page.waitForFunction(()=>!document.querySelector('.extras-tag-preview'));await publicPage.reload();await publicPage.waitForFunction(()=>document.getElementById('collarStatus').textContent.includes('отключил'));assert.equal(await publicPage.locator('a.contact').count(),0);await publicPage.close();
 await open('wellbeing');await click('Изменить отметки');await page.evaluate(()=>{window.extrasSavedSync=PetCareSync.save;PetCareSync.save=async()=>{throw new Error('disk full')}});await page.locator('#wellNote').fill('Not saved');await form().locator('button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('extrasFormStatus').textContent.includes('Не удалось сохранить'));assert(!await page.evaluate(()=>appData.wellbeingEntries[0].note.includes('Not saved')));await page.evaluate(()=>{PetCareSync.save=window.extrasSavedSync});await page.keyboard.press('Escape');
 await page.evaluate(auth=>supabaseClient.auth.setSession({access_token:auth.access_token,refresh_token:auth.refresh_token}),session(other));await page.waitForFunction(id=>activeUserId===id,other);assert.equal(await page.evaluate(()=>appData.expenses.length),0);assert.equal(await page.evaluate(()=>appData.wellbeingEntries.length),0);assert.equal(await page.evaluate(()=>appData.foodStocks.length),0);
 console.log('PASS: wellbeing history/XSS, integer monthly expenses, food forecast, offline reload/sync, private multi-source search, chat drafts/confirmation/deduplication, collar photo/public view/download/revocation, 320/390/1440 layouts, local storage failure and account isolation (mocked services).');
};
