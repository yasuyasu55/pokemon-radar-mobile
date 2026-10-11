// Read-only scanner for the existing Windows POKEMON RADAR / CRAWL STORM source tree.
// It never writes to the target project. It prints likely batch-crawl entry points.
import fs from 'node:fs';
import path from 'node:path';

const root=process.argv[2];
if(!root)throw new Error('Usage: node inspect-crawl-storm-entry.mjs <pokemon-radar-root>');
const wanted=[
 'src/app/api/crawl',
 'src/lib/crawler',
 'src/lib/actions',
 'chrome-extension'
];
const files=[];
function walk(dir){
 if(!fs.existsSync(dir))return;
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.name==='node_modules'||e.name==='.next'||e.name==='.git')continue;
  const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p);
  else if(/\.(?:js|mjs|cjs|ts|tsx)$/.test(e.name))files.push(p);
 }
}
for(const rel of wanted)walk(path.join(root,rel));

const patterns=[
 /\/api\/crawl\/[A-Za-z0-9_\-/]+/g,
 /chrome\.runtime\.sendMessage\([^\n]{0,240}/g,
 /chrome\.tabs\.sendMessage\([^\n]{0,240}/g,
 /(?:START|RUN|BATCH|CRAWL)[A-Z0-9_\-]{2,}/g,
 /fetch\([^\n]{0,260}/g,
 /batchEngine[^\n]{0,220}/gi,
 /run-complete[^\n]{0,220}/gi
];
const hits=[];
for(const file of files){
 let text='';
 try{text=fs.readFileSync(file,'utf8');}catch{continue;}
 for(const re of patterns){
  re.lastIndex=0;
  for(const m of text.matchAll(re)){
   const before=text.slice(0,m.index).split('\n').length;
   hits.push({file:path.relative(root,file).replaceAll('\\','/'),line:before,text:m[0].slice(0,320)});
  }
 }
}
const unique=[];
const seen=new Set();
for(const h of hits){
 const key=h.file+'|'+h.line+'|'+h.text;
 if(!seen.has(key)){seen.add(key);unique.push(h);}
}
const endpoints=[...new Set(unique.flatMap(h=>h.text.match(/\/api\/crawl\/[A-Za-z0-9_\-/]+/g)||[]))].sort();
const messages=unique.filter(h=>/sendMessage|START|RUN|BATCH|CRAWL|batchEngine/i.test(h.text));
const out={
 root:path.resolve(root),
 scannedFiles:files.length,
 endpoints,
 likelyMessages:messages.slice(0,120),
 allHits:unique.slice(0,300)
};
console.log(JSON.stringify(out,null,2));
