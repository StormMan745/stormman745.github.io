// PDF parsing is local; the original file is never sent to a third-party viewer.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
const destination = path.join(root, 'assets/vendor/pdfjs');
fs.mkdirSync(destination, { recursive: true });
for (const [entry, globalName, name] of [
    ['legacy/build/pdf.mjs', 'PetCarePDF', 'pdf.runtime.min.js'],
    ['legacy/build/pdf.worker.mjs', 'pdfjsWorker', 'pdf.worker.classic.min.js']
]) {
    esbuild.buildSync({ entryPoints: [path.join(source, entry)], outfile: path.join(destination, name),
        bundle: true, format: 'iife', globalName, minify: true, target: 'es2022', legalComments: 'inline',
        banner: { js: '/* PDF.js 6.5.438 / Mozilla Foundation. Apache-2.0. See LICENSE.txt. */' } });
}
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    fs.cpSync(path.join(source, directory), path.join(destination, directory), { recursive: true, filter: file => !file.endsWith('.map') });
}
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE.txt'));
esbuild.buildSync({ entryPoints: [path.join(root, 'document-print.js')], outfile: path.join(root, 'document-print.bundle.js'),
    bundle: true, format: 'iife', target: 'es2022', legalComments: 'inline',
    define: { PETCARE_PRINT_CSS: JSON.stringify(fs.readFileSync(path.join(root, 'document-print.css'), 'utf8')) } });
console.log('Built local PDF.js print renderer (6.5.438).');
