const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(desktop, '..');
const output = path.join(desktop, 'www');
if (path.dirname(output) !== desktop || path.basename(output) !== 'www') throw Error('Unsafe output');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'app.bundle.js', 'app.bundle.css', 'document-ocr.js', 'style.css', 'script.js', 'documents.js', 'documents.css', 'experience.js',
  'sync.js','offline-files.js','care.js','care.css','vet.html','vet.js','vet.css',
  'experience.css', 'clinics.css', 'clinics.bundle.js', 'pet-scene.js', 'frameguard.js', 'install.js',
  'manifest.webmanifest', 'document-print.html', 'document-print.css', 'document-print.bundle.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.cpSync(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(desktop, 'src/desktop.js')], outfile: path.join(output, 'desktop.js'),
  bundle: true, format: 'iife', target: 'es2022', legalComments: 'inline' });
esbuild.buildSync({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: desktop },
  outfile: path.join(output, 'supabase.js'), bundle: true, format: 'iife', globalName: 'supabase', target: 'es2022' });
let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
html = html.replace(/(<script src="install\.js[^\"]*"><\/script>)/, '<script src="desktop.js"></script>\n$1')
  .replace(/<script src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js|assets\/vendor\/supabase\/supabase-2\.118\.0\.min\.js)[^>]*><\/script>/, '<script src="supabase.js"></script>')
  .replace(' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', '')
  .replace('; upgrade-insecure-requests', '')
  .replace('</head>', '<link rel="stylesheet" href="desktop.css">\n</head>');
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.copyFileSync(path.join(desktop, 'src/desktop.css'), path.join(output, 'desktop.css'));
// A PNG-compressed ICO is supported by Windows Vista and later.
const png = fs.readFileSync(path.join(desktop, 'icon.png'));
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); // Zero width/height encode 256 in ICO.
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(desktop, 'icon.ico'), Buffer.concat([header, png]));
console.log('Built local Windows app assets.');
