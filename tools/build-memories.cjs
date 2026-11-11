const fs=require('node:fs'),path=require('node:path'),{buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
const result=buildSync({entryPoints:[path.join(root,'memories.js')],bundle:true,write:false,format:'iife',target:'es2020',minify:true,legalComments:'eof',nodePaths:[path.join(__dirname,'node_modules')]});
const output=result.outputFiles[0].contents, name=path.join(root,'memories.bundle.js');
if(process.argv.includes('--check')){if(!fs.existsSync(name)||!Buffer.from(output).equals(fs.readFileSync(name)))throw new Error('memories.bundle.js is stale');}
else fs.writeFileSync(name,output);
console.log('PASS: memory video runtime ('+output.length+' bytes).');
