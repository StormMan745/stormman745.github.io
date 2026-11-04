const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../.tools/preview/node_modules/playwright');
function samplePdf() {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    for (const text of ['Examination results - page 1', 'Examination results - page 2']) {
        const stream = `BT /F1 24 Tf 50 500 Td (${text}) Tj ET\n0.2 0.6 0.3 rg 50 300 240 80 re f`;
        objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    }
    let result = '%PDF-1.4\n', offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const start = Buffer.byteLength(result);
    result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    return Buffer.from(result + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
}
(async () => {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((req, res) => {
        const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/^\/$/, '/index.html'));
        if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
        fs.readFile(file, (error, bytes) => {
            if (error) return res.writeHead(404).end();
            const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.wasm': 'application/wasm' };
            res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext();
        const errors = [];
        context.on('page', page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (process.env.PRINT_DEBUG && m.type() === 'error') console.error(m.text()); }); });
        await context.route('https://**', route => route.abort());
        await context.addInitScript(({ pdf }) => {
            window.print = () => { window.printCalls = (window.printCalls || 0) + 1; };
            const state = window.printTest = { fail: false, delayed: false, pdf };
            const uid = 'a1000000-0000-4000-8000-000000000001';
            const rows = [{ id:'doc-pdf', user_id:uid, pet_id:'one', title:'<img src=x onerror=alert(1)> Анализы', category:'analysis', document_date:'2026-11-04', file_name:'results.pdf', mime_type:'application/pdf', file_size:2000, storage_path:`${uid}/doc-pdf/original.pdf` },
                { id:'doc-image', user_id:uid, pet_id:'one', title:'Скан заключения', category:'conclusion', document_date:'2026-11-04', file_name:'scan.png', mime_type:'image/png', file_size:100, storage_path:`${uid}/doc-image/original.png` }];
            const builder = { select(){return this},eq(){return this},order(){return this},then(resolve){resolve({data:rows,error:null})} };
            const client = { auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange(){}},from:()=>builder,
                storage:{from:()=>({download:async file => {
                    if(state.delayed) await new Promise(resolve=>state.release=resolve);
                    if(state.fail)return {error:new Error('network')};
                    const data=file.endsWith('.pdf') ? atob(state.pdf) : atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3FoAAAAASUVORK5CYII=');
                    return {data:new Blob([Uint8Array.from(data,c=>c.charCodeAt(0))]),error:null};
                }})} };
            Object.defineProperty(window,'supabase',{get:()=>({createClient:()=>client}),set(){},configurable:true});
        }, { pdf: samplePdf().toString('base64') });
        for(const mode of ['http','file']) {
            const page = await context.newPage();
            await page.goto(mode==='http'?`http://127.0.0.1:${server.address().port}/`:pathToFileURL(path.join(root,'index.html')).href);
            await page.waitForFunction(()=>window.PetCareDocuments);
            await page.evaluate(async()=>{
                activeUserId='a1000000-0000-4000-8000-000000000001';appData=createInitialAppData();
                appData.pets=[{id:'one',name:'Барни',animal:'🐶'}];appData.pet=appData.pets[0];appData.activePetId='one';normalizeAppData();await PetCareDocuments.open();
            });
            const openPrint = async id => {
                const pending=page.waitForEvent('popup');await page.locator(`[data-document-action="print"][data-document-id="${id}"]`).click();return pending;
            };
            const pdf=await openPrint('doc-pdf');
            if(mode==='file' && process.env.PRINT_DEBUG) { await pdf.waitForTimeout(1000); console.error(await pdf.evaluate(()=>({url:location.href,state:document.readyState,ready:!!window.PetCareDocumentPrint,scripts:[...document.scripts].map(s=>s.src),html:document.body?.innerHTML.slice(0,250)}))); }
            try { await pdf.waitForFunction(()=>document.body?.classList.contains('print-ready'),null,{timeout:45000}); }
            catch(error) { console.error({mode,status:await page.locator('#documentStatus').innerText(),errors}); throw error; }
            assert.equal(await pdf.locator('.print-sheet').count(),2);
            assert.equal(await pdf.locator('h1 img').count(),0,'Metadata must render as text');
            assert.match(await pdf.locator('h1').innerText(),/onerror/);
            assert(await pdf.locator('.print-sheet img').evaluateAll(images=>images.every(img=>img.naturalWidth>1000&&img.naturalHeight>1000)));
            for(const width of [320,1440]) {
                await pdf.setViewportSize({width,height:900});
                assert(await pdf.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            }
            await pdf.locator('#printButton').click();assert.equal(await pdf.evaluate(()=>window.printCalls),1);
            if(mode==='http') {
                await pdf.pdf({path:path.join(root,'.tools/document-print-output.pdf'),preferCSSPageSize:true,printBackground:true});
                const bytes=fs.readFileSync(path.join(root,'.tools/document-print-output.pdf'));
                const count=await pdf.evaluate(async encoded=>{const task=PetCarePDF.getDocument({data:Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),isEvalSupported:false});const p=await task.promise;const n=p.numPages;await task.destroy();return n;},bytes.toString('base64'));
                assert.equal(count,2,'Printed output must contain exactly two pages');
                await pdf.screenshot({path:path.join(root,'.tools/document-print-preview.png'),fullPage:true});
            }
            await pdf.close();await page.waitForFunction(()=>!document.getElementById('documentSave').disabled);
            const image=await openPrint('doc-image');
            await image.waitForFunction(()=>document.body?.classList.contains('print-ready'));
            assert.equal(await image.locator('.print-sheet').count(),1);
            await image.locator('#printButton').click();assert.equal(await image.evaluate(()=>window.printCalls),1);await image.close();
            await page.waitForFunction(()=>!document.getElementById('documentSave').disabled);
            await page.evaluate(()=>{printTest.fail=true});
            const failed=await openPrint('doc-pdf');await failed.waitForEvent('close');
            assert.match(await page.locator('#documentStatus').innerText(),/Не удалось загрузить/);
            await page.evaluate(()=>{printTest.fail=false;printTest.pdf=btoa('broken PDF');});
            const broken=await openPrint('doc-pdf');
            await broken.waitForFunction(()=>document.getElementById('printStatus')?.dataset.error==='true');
            assert.equal(await broken.locator('#printButton').isDisabled(),true);assert.equal(await broken.locator('.print-sheet').count(),0);await broken.close();
            await page.waitForFunction(()=>!document.getElementById('documentSave').disabled);
            await page.evaluate(()=>{printTest.delayed=true});
            const stale=await openPrint('doc-pdf');
            await page.waitForFunction(()=>printTest.release);
            const closed = stale.waitForEvent('close');
            await page.evaluate(()=>{resetActiveAccountData();printTest.release();});
            await closed;
            assert.equal(stale.isClosed(),true,'Logout must close private preview');
            await page.close();
            console.log(`PASS ${mode}: PDF (2 pages + landscape), scan, print action, metadata escaping, responsive preview, network failure, corrupt PDF, account reset.`);
        }
        assert.deepEqual(errors,[]);
    } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
