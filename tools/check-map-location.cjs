const assert=require('node:assert/strict');
module.exports=async({page,context})=>{
  await context.route('https://yandex.ru/map-widget/v1/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="ru"><body>Синтетический виджет карты</body></html>'}));
  await context.setGeolocation({latitude:55.75,longitude:37.61,accuracy:25});await context.grantPermissions(['geolocation']);
  const baseline=await page.evaluate(()=>JSON.stringify(appData)),start=page.url();
  await page.evaluate(()=>showClinics());
  const map=()=>page.locator('.clinic-yandex-map');
  const url=async()=>new URL(await map().getAttribute('src'));
  await page.waitForFunction(()=>document.querySelector('.clinic-yandex-map')?.src.includes('pt='));
  let current=await url();assert.equal(current.searchParams.get('mode'),'search');assert.equal(current.searchParams.get('pt'),'37.61,55.75,pm2blm');assert.match(current.searchParams.get('text'),/ветеринарные клиники/);assert(await page.locator('#clinicLocationLegend').isVisible());
  assert.match(await map().getAttribute('allow'),/geolocation 'none'/);assert(!/allow-top-navigation/.test(await map().getAttribute('sandbox')));
  await page.locator('#clinicCategory').selectOption('walking');current=await url();assert.match(current.searchParams.get('text'),/площадки для выгула собак/);assert.equal(current.searchParams.get('pt'),'37.61,55.75,pm2blm');
  await page.locator('#clinicAddress').fill('Москва, Тверская 10');await page.locator('#clinicAddress').press('Enter');current=await url();assert.match(current.searchParams.get('text'),/Тверская 10/);assert.equal(current.searchParams.get('pt'),'37.61,55.75,pm2blm');assert(!current.searchParams.has('ll'),'Address search chooses its own area');assert.equal(page.url(),start,'Search must not reload the application');
  await page.locator('#clinicMapSelect').selectOption('__location__');current=await url();assert.equal(current.searchParams.get('mode'),'search');assert.equal(current.searchParams.get('z'),'16');assert.equal(current.searchParams.get('ll'),'37.61,55.75');assert.match(current.searchParams.get('text'),/площадки/);assert(!current.searchParams.get('text').includes('Тверская'));
  await page.locator('#clinicMapSelect').selectOption('__results__');current=await url();assert.match(current.searchParams.get('text'),/Тверская/);assert.equal(await page.locator('#clinicAddress').inputValue(),'Москва, Тверская 10');
  await context.setGeolocation({latitude:55.76,longitude:37.63,accuracy:30});await page.locator('#clinicLocateButton').click();await page.waitForFunction(()=>document.querySelector('.clinic-yandex-map')?.src.includes('37.63'));
  current=await url();assert.match(current.searchParams.get('text'),/Тверская/);assert.equal(current.searchParams.get('pt'),'37.63,55.76,pm2blm');assert.equal(new URL(await page.locator('#clinicExternalSearch').getAttribute('href')).searchParams.get('pt'),'37.63,55.76,pm2blm');
  await page.locator('#clinicCategory').selectOption('clinics');await page.locator('#clinicOpenOnly').uncheck();current=await url();assert(!current.searchParams.get('text').includes('открыто сейчас'));assert.equal(current.searchParams.get('pt'),'37.63,55.76,pm2blm');
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Fits '+width);await page.locator('.clinic-map-wrap').screenshot({path:'.tools/map-location-'+width+'.png'});}
  assert.equal(await page.evaluate(()=>JSON.stringify(appData)),baseline,'Coordinates stay out of the pet profile');
  await page.evaluate(()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,error){window.delayedLocation=success;window.delayedLocationError=error;}}});});
  await page.locator('#clinicLocateButton').click();await page.waitForFunction(()=>!!window.delayedLocation);
  await page.evaluate(()=>{window.dispatchEvent(new Event('petcare:account-reset'));delayedLocation({coords:{latitude:56,longitude:38,accuracy:5}});});
  assert.equal(await map().count(),0,'A late GPS response cannot restore another account map');assert(!await page.locator('#clinicLocationLegend').isVisible());assert.equal(await page.locator('#clinicAddress').inputValue(),'');
  await page.locator('#clinicAddress').fill('Санкт-Петербург, Невский 20');await page.locator('#clinicSearchButton').click();current=await url();assert(!current.searchParams.has('pt'),'No stale GPS after account reset');
  await page.locator('#clinicLocateButton').click();await page.evaluate(()=>delayedLocationError({code:1}));assert.match(await page.locator('#clinicStatus').innerText(),/запрещён/);assert.equal((await url()).searchParams.get('pt'),null,'Denial leaves address results available');
  console.log('PASS: results and GPS together; categories, filters, address/Enter, zoom and external link retain the point; GPS refresh keeps the address; no native navigation, no iframe GPS permission, no profile persistence, responsive layouts, late-response/account reset and denied location. Map and auth services mocked.');
};
