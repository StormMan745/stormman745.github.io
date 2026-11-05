const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url'),{chromium}=require('../.tools/preview/node_modules/playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(error,bytes)=>{if(error)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream'});res.end(bytes);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const url of [`http://127.0.0.1:${server.address().port}/`,pathToFileURL(path.join(root,'index.html')).href]){
   const context=await browser.newContext();let calls=0,release;const errors=[];
   await context.route('https://qexiyikdmdbdxgusqnee.supabase.co/**',async route=>{calls++;await new Promise(resolve=>release=resolve);await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({msg:'Invalid credentials <img src=x onerror=alert(1)>',code:'invalid_credentials'})});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.PetCareCare&&document.getElementById('authPage').style.display==='flex');
   for(const mode of ['login','register']){
    await page.locator('#'+mode+'Tab').click();await page.locator('#'+mode+'Email').fill('test@example.invalid');await page.locator('#'+mode+'Password').fill('test-only-password');
    if(mode==='register')await page.locator('#registerPassword2').fill('test-only-password');
    const before=calls;release=null;
    await page.locator('#'+mode+'Password').press('Enter');
    for(let n=0;n<100&&!release;n++)await new Promise(resolve=>setTimeout(resolve,10));assert(release,'Enter must initiate authentication');
    assert(await page.locator('#'+mode+'Button').isDisabled());
    await page.evaluate(mode=>Promise.all([submitAuth(mode==='register'),submitAuth(mode==='register')]),mode);
    assert.equal(calls,before+1,'Repeated submissions must share the pending attempt');release();
    await page.waitForFunction(()=>!authSubmitting);assert.equal(await page.locator('#authMessage img').count(),0);assert.match(await page.locator('#authMessage').innerText(),/Ошибка/);assert(!await page.locator('#'+mode+'Button').isDisabled());
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: HTTP and file:// login/registration via Enter, in-flight duplicate prevention, retry after error, error text escaping. Auth mocked; no real accounts used.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
