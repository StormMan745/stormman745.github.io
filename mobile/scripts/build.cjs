const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const mobile = path.resolve(__dirname, '..');
const root = path.resolve(mobile, '..');
const output = path.join(mobile, 'www');
// Only this generated directory may be replaced. Never copy tools or server files.
if (path.dirname(output) !== mobile || path.basename(output) !== 'www') throw Error('Unsafe output path');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const files = ['index.html', 'app.bundle.js', 'app.bundle.css', 'memories.bundle.js', 'document-ocr.js', 'style.css', 'script.js', 'documents.js', 'documents.css',
  'sync.js','offline-files.js','care.js','care.css','vet.html','vet.js','vet.css',
  'experience.js', 'experience.css', 'clinics.css', 'clinics.bundle.js', 'pet-scene.js',
  'frameguard.js', 'install.js', 'manifest.webmanifest', 'document-print.html', 'document-print.css', 'document-print.bundle.js'];
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.cpSync(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
fs.copyFileSync(path.join(mobile, 'src/native.css'), path.join(output, 'native.css'));
esbuild.buildSync({ entryPoints: [path.join(mobile, 'src/native.js')], outfile: path.join(output, 'native.js'),
  bundle: true, format: 'iife', target: 'es2022', legalComments: 'inline' });
// Bundle the SAME pinned SDK as the website, so launching needs no CDN request.
esbuild.buildSync({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: mobile },
  outfile: path.join(output, 'supabase.js'), bundle: true, format: 'iife', globalName: 'supabase', target: 'es2022' });
let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
html = html.replace(/(<script src="install\.js[^\"]*"><\/script>)/, '<script src="native.js"></script>\n$1')
  .replace(/<script src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js|assets\/vendor\/supabase\/supabase-2\.118\.0\.min\.js)[^>]*><\/script>/,
    '<script src="supabase.js"></script>')
  .replace('</head>', '<link rel="stylesheet" href="native.css">\n</head>')
  .replace(' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', '')
  .replace("; upgrade-insecure-requests", '');
// WebKit's local capacitor:// origin must not be upgraded to https://.
fs.writeFileSync(path.join(output, 'index.html'), html);
if (/cdn\.jsdelivr\.net/.test(html)) throw Error('Unexpected remote/mobile bootstrap');
console.log('Mobile assets built in mobile/www (Android + iOS).');
