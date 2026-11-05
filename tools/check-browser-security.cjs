const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../.tools/preview/node_modules/playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');let leaked=0;
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/leak'){leaked++;return res.end('blocked by test');}
  if(name==='/csp-probe.js'){res.setHeader('Content-Type','text/javascript');return res.end("try{window.eval('window.__evalInjected=1')}catch{window.evalBlocked=true}window.evalProbeDone=true;");}
  if(name==='/frame-test'){res.setHeader('Content-Type','text/html');return res.end('<iframe src="/index.html"></iframe><iframe src="/vet.html"></iframe><iframe src="/document-print.html"></iframe>');}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(error,bytes)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const context=await browser.newContext();let externalScripts=0,shareCalls=0,limited=false,expires=Date.now()+3600000;
  const payload='<img src=x onerror="window.__injected=1">';
  await context.route('https://evil.invalid/**',r=>{externalScripts++;return r.abort();});
  await context.route('https://yandex.ru/map-widget/v1/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<button id="jump">Test navigation</button>'}));
  await context.route('https://qexiyikdmdbdxgusqnee.supabase.co/**',async route=>{
   if(!route.request().url().includes('/functions/v1/petcare-platform'))return route.abort();
   shareCalls++;const body=route.request().postDataJSON();
   if(limited)return route.fulfill({status:429,headers:{'Content-Type':'application/json','Retry-After':'60','Access-Control-Allow-Origin':'*'},body:'{"error":"rate_limited"}'});
   if(body.action==='share-file')return route.fulfill({status:404,body:'{}'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{pet:{name:payload,breed:payload},healthRecords:[{name:payload,note:payload}]},expiresAt:new Date(expires).toISOString(),documents:[{id:'doc-test',title:payload,file_name:'test.pdf',document_date:'2026-11-05'}]})});
  });
  const page=await context.newPage();if(process.env.SECURITY_DEBUG)page.on('console',message=>{if(message.type()==='error')console.log(message.text());});await page.goto(base);await page.waitForFunction(()=>window.PetCareCare);
  await page.evaluate(()=>{
   window.violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.effectiveDirective));
   const script=document.createElement('script');script.textContent='window.__injected=1';document.head.append(script);
   const external=document.createElement('script');external.src='https://evil.invalid/payload.js';document.head.append(external);
   // DevTools evaluation can bypass CSP's eval gate; test from an ordinary
   // same-origin script loaded by the browser instead of page.evaluate itself.
   const probe=document.createElement('script');probe.src='/csp-probe.js';document.head.append(probe);
   const form=document.createElement('form');form.action='/leak';form.method='POST';const input=document.createElement('input');input.name='private';input.value='synthetic-test-only';form.append(input);document.body.append(form);form.submit();form.remove();
  });
  await page.waitForFunction(()=>window.evalProbeDone&&violations.includes('form-action')&&violations.includes('script-src-elem'));
  assert.equal(await page.evaluate(()=>window.evalBlocked),true);
  assert.equal(leaked,0);assert.equal(externalScripts,0);assert.equal(await page.evaluate(()=>window.__injected||window.__evalInjected),undefined);
  // Start UI checks with a fresh document after the deliberately blocked POST.
  await page.goto(base);await page.waitForFunction(()=>window.PetCareCare);
  await page.evaluate(payload=>{activeUserId='security-preview';appData=createInitialAppData();appData.pet={id:'safe-pet',name:payload,animal:'🐶'};appData.pets=[appData.pet];appData.healthRecords=[{id:'safe-record',petId:'safe-pet',name:payload,note:payload,date:'2026-11-05'}];normalizeAppData();showHealth();},payload);
  assert.equal(await page.locator('[onerror]').count(),0,'Record content must stay text');assert((await page.locator('body').innerText()).includes(payload));
  await page.evaluate(()=>showClinics());await page.locator('#clinicAddress').fill('Москва, Тверская 10');await page.locator('#clinicSearchButton').click();
  const jump=page.frameLocator('.clinic-yandex-map').locator('#jump');
  await jump.evaluate(button=>button.addEventListener('click',()=>{document.body.dataset.attempted='yes';try{top.location.href='https://evil.invalid/steal';}catch{document.body.dataset.blocked='yes';}}));
  await jump.click();
  await page.frameLocator('.clinic-yandex-map').locator('body[data-attempted="yes"]').waitFor({state:'attached'});
  assert.equal(await page.frameLocator('.clinic-yandex-map').locator('body').getAttribute('data-blocked'),'yes');
  assert.equal(page.url(),base+'/','Embedded map cannot replace the application');
  assert.match(await page.locator('.clinic-yandex-map').getAttribute('allow'),/geolocation 'none'/);
  // All public document/app pages hide their controls inside an embedding frame.
  await page.goto(base+'/frame-test');await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(frame=>frame.contentDocument?.documentElement.style.display==='none'));
  const vet=await context.newPage();await vet.clock.install();await vet.goto(base+'/vet.html#'+'a'.repeat(43));await vet.locator('#vetContent h2').first().waitFor();
  assert.equal(await vet.locator('#vetContent img').count(),0);assert.equal(await vet.evaluate(()=>window.__injected),undefined);
  limited=true;await vet.locator('#vetContent button').click();await vet.waitForFunction(()=>document.getElementById('vetStatus').textContent.includes('Слишком много'));
  const count=shareCalls;await vet.locator('#vetContent button').click();assert.equal(shareCalls,count,'Honor Retry-After without another network request');
  limited=false;expires=Date.now()+1000;await vet.reload();await vet.locator('#vetContent h2').first().waitFor();await vet.clock.fastForward(2000);
  assert.equal(await vet.locator('#vetContent').innerText(),'');assert.match(await vet.locator('#vetStatus').innerText(),/истёк/);
  await context.close();console.log('PASS: CSP blocks injected/external scripts, eval and native form submission; record/share XSS payloads stay text; embedded pages hide controls; share limits and exact expiry enforced. Synthetic data and mocked APIs only.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
