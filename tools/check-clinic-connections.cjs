const assert=require('node:assert/strict');
module.exports=async({page,context,profiles,uid,objects,setAvailable})=>{
 await page.evaluate(()=>showHealth());await page.locator('#clinicConnectionsButton').click();
 const dialog=page.locator('#clinicConnectionDialog');await page.waitForFunction(()=>document.getElementById('clinicConnectionList').textContent.includes('Подключений пока нет'));
 await page.locator('#clinicConnectionName').fill('Тестовая клиника');
 await page.locator('#clinicConnectionCreate').click();assert.equal(objects.get('test-clinics'),undefined,'Consent is mandatory');
 await page.locator('#clinicConnectionConsent').check();await page.locator('#clinicConnectionCreate').click();
 await page.waitForFunction(()=>!document.getElementById('clinicConnectionSecret').hidden);
 assert.equal((objects.get('test-clinics')||[])[0].user_id,uid);assert.equal((objects.get('test-clinics')||[])[0].pet_id,'pet-one');
 await page.waitForFunction(()=>document.getElementById('clinicConnectionList').textContent.includes('Ожидает настройки клиникой'));
 const token=await page.locator('#clinicConnectionKey').inputValue();assert.match(token,/^pc_clinic_/);
 assert.equal(await page.evaluate(token=>JSON.stringify(appData).includes(token)||JSON.stringify(localStorage).includes(token),token),false,'Raw integration keys are not persisted');
 const download=page.waitForEvent('download');await page.locator('#clinicConnectionDownload').click();const file=await download;
 const config=JSON.parse(require('node:fs').readFileSync(await file.path(),'utf8'));assert.equal(config.authorization,'Bearer '+token);assert.equal(config.examinationExample.record.kind,'examination');
 objects.get('test-clinics')[0].received_count=1;objects.get('test-clinics')[0].last_received_at=new Date().toISOString();await page.locator('#clinicConnectionRefresh').click();
 await page.waitForFunction(()=>document.getElementById('clinicConnectionList').textContent.includes('Получено записей: 1'));
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});assert(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth),'Dialog fits '+width);await dialog.screenshot({path:'.tools/clinic-connections-'+width+'.png'});}
 await page.locator('#clinicConnectionList button').click();await page.waitForFunction(()=>document.getElementById('clinicConnectionList').textContent.includes('Разрешение отозвано'));
 assert.equal(await page.locator('#clinicConnectionKey').inputValue(),'');
 await page.evaluate(()=>{appData.pets.push({id:'pet-two',name:appData.pet.name});switchPet('pet-two')});await page.waitForFunction(()=>!document.getElementById('clinicConnectionDialog').open);
 await page.evaluate(()=>PetCareClinicConnections.open());await page.waitForFunction(()=>document.getElementById('clinicConnectionList').textContent.includes('Подключений пока нет'));
 assert.equal(await page.locator('#clinicConnectionKey').inputValue(),'');await page.keyboard.press('Escape');
 setAvailable(false);await context.setOffline(true);await page.evaluate(()=>PetCareClinicConnections.open());assert.match(await page.locator('#clinicConnectionStatus').innerText(),/нужен интернет/);await page.keyboard.press('Escape');
 setAvailable(true);await context.setOffline(false);await page.evaluate(()=>switchPet('pet-one'));await page.evaluate(()=>PetCareClinicConnections.open());
 await page.locator('.clinic-government summary').click();assert.match(await page.locator('.clinic-government').innerText(),/пока не подключена/);
 await page.locator('#clinicConnectionDocuments').click();await page.waitForFunction(()=>document.getElementById('documentsPage').style.display==='block');
 assert.equal(await dialog.evaluate(d=>d.open),false);
 console.log('PASS: clinic consent/setup export, waiting/received/revoked statuses, write-key privacy, same-name pet isolation, offline handling, government fallback and responsive dialog. Services mocked.');
};
