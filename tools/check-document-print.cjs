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
        await context.addInitScript(() => { window.print=()=>{window.printCalls=(window.printCalls||0)+1}; });
        const original=samplePdf().toString('base64');
        const prepare=async(page,encoded,mime='application/pdf')=>{
            await page.waitForFunction(()=>window.PetCareDocumentPrint);
            await page.evaluate(async({encoded,mime})=>{await PetCareDocumentPrint.prepare(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))]),{title:'<img src=x onerror=alert(1)> Анализы',mime});},{encoded,mime});
        };
        for(const mode of ['http','file']) {
            const address=mode==='http'?'http://127.0.0.1:'+server.address().port+'/document-print.html':pathToFileURL(path.join(root,'document-print.html')).href;
            const pdf=await context.newPage();await pdf.goto(address);await prepare(pdf,original);
            await pdf.waitForFunction(()=>document.body.classList.contains('print-ready'));
            assert.equal(await pdf.locator('.print-sheet').count(),2);
            assert.equal(await pdf.locator('h1 img').count(),0);assert.match(await pdf.locator('h1').innerText(),/onerror/);
            assert(await pdf.locator('.print-sheet img').evaluateAll(images=>images.every(img=>img.naturalWidth>1000&&img.naturalHeight>1000)));
            for(const width of [320,1440]){await pdf.setViewportSize({width,height:900});assert(await pdf.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
            await pdf.locator('#printButton').click();assert.equal(await pdf.evaluate(()=>printCalls),1);
            if(mode==='http'){
                const output=await pdf.pdf({preferCSSPageSize:true,printBackground:true});
                const count=await pdf.evaluate(async encoded=>{const task=PetCarePDF.getDocument({data:Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),isEvalSupported:false});const doc=await task.promise;const count=doc.numPages;await task.destroy();return count;},output.toString('base64'));
                assert.equal(count,2,'Printed output must contain exactly two pages');
                await pdf.screenshot({path:path.join(root,'.tools/document-print-preview.png'),fullPage:true});
            }
            await pdf.close();
            const image=await context.newPage();await image.goto(address);await prepare(image,'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3FoAAAAASUVORK5CYII=','image/png');
            assert.equal(await image.locator('.print-sheet').count(),1);await image.locator('#printButton').click();assert.equal(await image.evaluate(()=>printCalls),1);await image.close();
            const broken=await context.newPage();await broken.goto(address);await prepare(broken,Buffer.from('broken PDF').toString('base64'));
            assert.equal(await broken.locator('#printButton').isDisabled(),true);assert.equal(await broken.locator('.print-sheet').count(),0);assert.equal(await broken.locator('#printStatus').getAttribute('data-error'),'true');await broken.close();
            console.log('PASS '+mode+': isolated print renderer, two-page portrait/landscape PDF, exact printed page count, scan, safe metadata, responsive preview and corrupt-PDF rejection.');
        }
        assert.deepEqual(errors,[]);
    } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
