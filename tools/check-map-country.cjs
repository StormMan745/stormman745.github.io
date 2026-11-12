const assert=require('node:assert/strict');
module.exports=async({page,context,profiles,uid})=>{
 const real=process.argv.includes('--real-map-country');
 await context.route('https://yandex.ru/map-widget/v1/**',r=>r.fulfill({contentType:'text/html',body:'<html><body>Yandex</body></html>'}));
 if(!real){for(const host of ['maps.google.com','www.google.com'])await context.route(`https://${host}/maps**`,r=>r.fulfill({contentType:'text/html',body:'<html><body>Google</body></html>'}));}
 await page.evaluate(()=>{Object.defineProperty(navigator,'permissions',{configurable:true,value:undefined});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,error){window.countryGPS={success,error}}}})});
 await page.evaluate(()=>showClinics());
 const start=page.url(),url=async()=>new URL(await page.locator('.clinic-provider-map').getAttribute('src'));
 assert.equal(await page.locator('#clinicCountry').inputValue(),'RU');assert((await page.locator('#clinicCountry option').count())>240);
 await page.locator('#clinicCountry').selectOption('FR');
 let current=await url();assert.equal(current.hostname,'maps.google.com');assert.equal(current.searchParams.get('gl'),'fr');assert.match(current.searchParams.get('q'),/veterinary clinics open now near France/);
 assert(!await page.locator('#clinicOfficialMap').isVisible());assert.match(await page.locator('#clinicProviderName').innerText(),/Google/);
 assert.equal(await page.locator('#clinicCategory option[value="vaccination"]').innerText(),'Вакцинация животных');
 await page.waitForFunction(()=>PetCareSync.state.phase==='saved');assert.equal(profiles.get(uid).data.mapCountry,'FR');
 await page.locator('#clinicAddress').fill('Paris, Rue de Rivoli');await page.locator('#clinicAddress').press('Enter');
 current=await url();assert.match(current.searchParams.get('q'),/Paris, Rue de Rivoli, France/);assert.equal(page.url(),start);
 assert(await page.locator('#clinicSearchButton').isEnabled());
 await page.evaluate(()=>countryGPS.success({coords:{latitude:48.8566,longitude:2.3522,accuracy:18}}));
 assert(await page.locator('#clinicMapControls').isVisible());assert(!await page.locator('#clinicLocationLegend').isVisible());
 await page.locator('#clinicMapSelect').selectOption('__location__');current=await url();assert.equal(current.searchParams.get('q'),'48.8566,2.3522');assert.equal(current.searchParams.get('z'),'16');
 await page.locator('#clinicMapSelect').selectOption('__results__');await page.locator('#clinicCategory').selectOption('walking');current=await url();assert.match(current.searchParams.get('q'),/dog parks/);assert.match(current.searchParams.get('q'),/Rue de Rivoli/);
 const external=new URL(await page.locator('#clinicExternalSearch').getAttribute('href'));assert.equal(external.searchParams.get('api'),'1');assert.equal(external.searchParams.get('query'),current.searchParams.get('q'));
 if(real){await page.locator('.clinic-google-map').scrollIntoViewIfNeeded();const frame=page.frameLocator('.clinic-google-map');await frame.locator('img').nth(10).waitFor({state:'attached',timeout:30000});await page.locator('.clinic-map-wrap').screenshot({path:'.tools/map-country-real.png'});console.log('PASS: actual Google embedded map loaded through production CSP and sandbox.');}
 assert.equal(await page.locator('.clinic-google-map').getAttribute('allow'),"camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-write 'none'");
 if(!real){const child=await page.locator('.clinic-google-map').contentFrame();assert.equal(await child.locator('body').evaluate(()=>{try{top.location.href='https://evil.invalid/steal';return false}catch{return true}}),true,'Embedded Google content cannot navigate the app');assert.equal(page.url(),start);}
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Fits '+width);const box=await page.locator('.clinic-provider-map').boundingBox();assert(box.width>250&&box.height>600,'Full-sized map');await page.locator('#clinicSearchPanel').screenshot({path:'.tools/map-country-'+width+'.png'});}
 // A denied location leaves the country/address search available and no GPS leaks into profiles.
 assert(!JSON.stringify(profiles.get(uid).data).includes('48.8566'));
 await page.reload();await page.waitForFunction(()=>typeof activeUserId!=='undefined'&&activeUserId&&document.getElementById('homePage').style.display==='block');await page.evaluate(()=>showClinics());
 assert.equal(await page.locator('#clinicCountry').inputValue(),'FR');assert.equal((await url()).searchParams.get('q'),'veterinary clinics open now near France');
 await context.setOffline(true);await page.locator('#clinicCountry').selectOption('DE');await page.waitForFunction(()=>PetCareSync.state.pending>0);assert.equal(await page.evaluate(()=>appData.mapCountry),'DE');
 await context.setOffline(false);await page.evaluate(()=>PetCareSync.flush());await page.waitForFunction(()=>PetCareSync.state.phase==='saved');assert.equal(profiles.get(uid).data.mapCountry,'DE');
 // Simulate account boundary before loading the next account snapshot, as sign-out does.
 await page.evaluate(()=>{resetActiveAccountData();applyAccountData({...createInitialAppData(),mapCountry:'TR'});activeUserId='other-user';showHome();showClinics()});
 assert.equal(await page.locator('#clinicCountry').inputValue(),'TR');assert.equal(await page.locator('#clinicAddress').inputValue(),'');assert.equal((await url()).searchParams.get('q'),'veterinary clinics open now near Türkiye');
 await page.evaluate(()=>{resetActiveAccountData();applyAccountData(createInitialAppData());activeUserId='new-user';showHome();showClinics()});
 assert.equal(await page.locator('#clinicCountry').inputValue(),'RU');assert.equal(await page.locator('.clinic-provider-map').count(),0);
 await page.locator('#clinicAddress').fill('Москва');await page.locator('#clinicSearchButton').click();current=await url();assert.equal(current.hostname,'yandex.ru');assert.match(current.searchParams.get('text'),/Москва/);
 console.log('PASS: 249 countries, provider/queries/branding/links, GPS view, address Enter without logout, full map size, 320/390/1440 layouts, account-scoped persistence/reload, offline sync and account reset. Auth mocked.');
};
