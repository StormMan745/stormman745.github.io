const fs=require('node:fs'),path=require('node:path'),{transformSync}=require('esbuild');
const target=path.resolve(__dirname,'../assets/vendor/qrcode');fs.mkdirSync(target,{recursive:true});
const entry=require.resolve('qrcode-generator');const code=transformSync(fs.readFileSync(entry,'utf8'),{loader:'js',target:'es2020',minify:true,legalComments:'inline'}).code;
fs.writeFileSync(path.join(target,'qrcode-2.0.4.min.js'),'/* qrcode-generator 2.0.4 (MIT), Kazuhiko Arase. Vendored for private, offline QR generation. */\n'+code);
fs.writeFileSync(path.join(target,'LICENSE'),'QR Code Generator for JavaScript\nCopyright (c) 2009 Kazuhiko Arase\n\n'+
'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\n'+
'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n'+
'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n');
console.log('Built local QR generator.');
