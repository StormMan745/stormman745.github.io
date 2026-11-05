const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
for(const file of ['index.html','vet.html','document-print.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];assert(policy,file+' requires CSP');
 for(const rule of ["object-src 'none'","base-uri 'none'","form-action 'none'"])assert(policy.includes(rule),file+' missing '+rule);
 const scripts=policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1];assert(scripts&&scripts.includes("'self'")&&!scripts.includes('unsafe-inline')&&!scripts.includes("'unsafe-eval'")&&!scripts.includes('https:'),file+' permits unsafe scripts');
 assert(!/<script\b[^>]*>\s*[^<\s]/i.test(html),file+' has inline script');
 assert(!/\son(?:click|error|load|submit|change)\s*=/i.test(html),file+' has inline handlers');
 assert(html.includes('src="frameguard.js"'),file+' missing frame guard');
}
const findings=[];
const privateKey=new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----');
const patterns=[privateKey,/sb_secret_[a-zA-Z0-9_-]{24,}/,/(?:ghp_|github_pat_)[a-zA-Z0-9_]{30,}/];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 if(['.git','.tools','node_modules','assets','desktop','mobile','dist','.temp'].includes(entry.name))continue;
 const file=path.join(dir,entry.name);if(entry.isDirectory()){walk(file);continue;}
 if(!/\.(?:[cm]?js|ts|json|html|css|sql|toml|ya?ml|md)$/.test(file))continue;
 const text=fs.readFileSync(file,'utf8');let secret=patterns.some(pattern=>pattern.test(text));
 for(const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g))try{if(JSON.parse(Buffer.from(match[1],'base64url')).role==='service_role')secret=true;}catch{}
 if(secret)findings.push(path.relative(root,file));
}}
walk(root);assert.deepEqual(findings,[],'Potential server credentials in source files (values withheld)');
console.log('PASS: CSP, disabled native form navigation, frame guards, inline handler restrictions and high-confidence secret patterns.');
