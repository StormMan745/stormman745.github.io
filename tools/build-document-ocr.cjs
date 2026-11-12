const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'assets/vendor/ocr');
fs.mkdirSync(target, { recursive: true });
for (const file of ['tesseract.min.js', 'worker.min.js'])
    fs.copyFileSync(path.join(__dirname, 'node_modules/tesseract.js/dist', file), path.join(target, file));
const core = path.join(__dirname, 'node_modules/tesseract.js-core');
for (const file of fs.readdirSync(core).filter(name => /\.wasm(\.js)?$/.test(name)))
    fs.copyFileSync(path.join(core, file), path.join(target, file));
fs.copyFileSync(path.join(__dirname, 'node_modules/tesseract.js/LICENSE.md'), path.join(target, 'LICENSE.txt'));
fs.copyFileSync(path.join(core, 'LICENSE'), path.join(target, 'LICENSE-core.txt'));
async function main() {
    for (const language of ['rus', 'eng']) {
        const file = path.join(target, language + '.traineddata.gz');
        if (fs.existsSync(file)) continue;
        const response = await fetch(`https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/${language}.traineddata.gz`);
        if (!response.ok) throw Error('Language download failed: ' + language);
        fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    console.log('Built local OCR assets: Tesseract.js 6.0.1, Russian + English.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
