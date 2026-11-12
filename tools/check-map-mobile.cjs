const assert=require('node:assert/strict');
module.exports=async({page,context})=>{
 await context.route('https://yandex.ru/map-widget/v1/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="ru"><body>Карта с результатами</body></html>'}));
 await page.evaluate(()=>{
  Object.defineProperty(navigator,'permissions',{configurable:true,value:undefined});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,error,options){window.mobileLocationCalls=(window.mobileLocationCalls||0)+1;window.mobileLocation={success,error,options};}}});
 });
 await page.evaluate(()=>showClinics());
 const baseline=await page.evaluate(()=>JSON.stringify(appData)),start=page.url();
 const map=()=>page.locator('.clinic-yandex-map'),url=async()=>new URL(await map().getAttribute('src'));
 const reset=()=>page.evaluate(()=>window.dispatchEvent(new Event('petcare:account-reset')));
 const search=async address=>{await page.locator('#clinicAddress').fill(address);await page.locator('#clinicAddress').press('Enter')};
 await search('Москва, Тверская 10');await page.waitForFunction(()=>Boolean(window.mobileLocation));
 assert.equal((await url()).searchParams.has('pt'),false);
 assert.equal(await page.locator('#clinicSearchButton').isEnabled(),true,'GPS must not block address results');
 assert.equal(await page.locator('#clinicLocateButton').isDisabled(),true);
 assert.equal(await page.evaluate(()=>mobileLocationCalls),1,'Address search requests location without the Permissions API');
 assert.equal(await page.evaluate(()=>mobileLocation.options.enableHighAccuracy),true);
 await page.locator('#clinicCategory').selectOption('walking');
 await page.waitForTimeout(750);await search('Москва, Арбат 12');
 assert.equal(await page.evaluate(()=>mobileLocationCalls),1,'Pending requests are shared across searches');
 await page.evaluate(()=>mobileLocation.success({coords:{latitude:55.75,longitude:37.61,accuracy:15}}));
 await page.waitForFunction(()=>document.querySelector('.clinic-yandex-map')?.src.includes('pt='));
 let current=await url();assert.equal(current.searchParams.get('pt'),'37.61,55.75,pm2blm');assert.match(current.searchParams.get('text'),/Арбат 12/);assert.match(current.searchParams.get('text'),/площадки/);
 assert.equal(await page.locator('#clinicAddress').inputValue(),'Москва, Арбат 12');assert(await page.locator('#clinicLocationLegend').isVisible());
 assert.equal(page.url(),start,'No form navigation or logout');assert.equal(await page.evaluate(()=>JSON.stringify(appData)),baseline,'GPS stays outside the account snapshot');
 await page.locator('#clinicMapSelect').selectOption('__location__');assert.equal((await url()).searchParams.get('ll'),'37.61,55.75');
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await reset();await search('Казань, Кремлёвская 1');
 await page.evaluate(()=>mobileLocation.error({code:1}));assert.match(await page.locator('#clinicLocationStatus').innerText(),/запрещён/);assert.equal((await url()).searchParams.has('pt'),false);assert(await map().isVisible());
 await page.waitForTimeout(750);await search('Казань, Баумана 5');assert.equal(await page.evaluate(()=>mobileLocationCalls),2,'Do not repeat a refused prompt on each search');
 await page.locator('#clinicLocateButton').click();await reset();await page.evaluate(()=>mobileLocation.success({coords:{latitude:56,longitude:38,accuracy:5}}));assert.equal(await map().count(),0,'An old request cannot restore a reset account map');
 // The native bridge must also obtain the position when permission was already granted.
 await page.evaluate(()=>{window.PetCareNative={checkLocationPermission:async()=>'granted',getCurrentPosition(success,error,options){window.mobileLocation={success,error,options}}};showHome();showClinics()});
 await page.waitForFunction(()=>document.getElementById('clinicLocateButton').disabled);
 await page.evaluate(()=>mobileLocation.success({coords:{latitude:55.76,longitude:37.63,accuracy:10}}));
 await page.waitForFunction(()=>document.querySelector('.clinic-yandex-map')?.src.includes('37.63'));
 assert.equal((await url()).searchParams.get('pt'),'37.63,55.76,pm2blm');
 await page.evaluate(()=>{delete window.PetCareNative});
 console.log('PASS: mobile search without Permissions API, prompt from user gesture, async GPS preserves latest address/category, no duplicate prompts, no blocking/reload/logout, refusal, reset races, native permission and responsive layouts. Coordinates and map mocked.');
};
