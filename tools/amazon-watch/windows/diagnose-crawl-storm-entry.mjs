// Windows read-only diagnostic for POKEMON RADAR / CRAWL STORM X.
// Finds likely current project folders, scans batchEngine/background/API routes,
// and emits a JSON report. It does not modify the target project or DB.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const roots=[
  path.join(os.homedir(),'Desktop'),
  path.join(os.homedir(),'Downloads'),
  path.join(os.homedir(),'Documents')
].filter(fs.existsSync);

const MAX_DIRS=25000;
let seenDirs=0;
const candidates=[];
function walk(dir,depth=0){
  if(depth>8||seenDirs++>MAX_DIRS)return;
  let ents=[];try{ents=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
  const names=new Set(ents.map(e=>e.name));
  if(names.has('package.json') && (names.has('chrome-extension')||names.has('src'))){
    let pkg={};try{pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));}catch{}
    const hasBatch=fs.existsSync(path.join(dir,'chrome-extension','batchEngine.js'));
    const hasCrawl=fs.existsSync(path.join(dir,'src','app','crawl','page.tsx'))||fs.existsSync(path.join(dir,'src','app','crawl','page.js'));
    if(hasBatch||hasCrawl||/pokemon.?radar/i.test(String(pkg.name||''))) candidates.push({dir,version:pkg.version||null,hasBatch,hasCrawl});
  }
  for(const e of ents){
    if(!e.isDirectory())continue;
    if(['node_modules','.git','.next','AppData','$Recycle.Bin','System Volume Information'].includes(e.name))continue;
    if(/^pokemon-radar-amazon-backups/i.test(e.name))continue;
    walk(path.join(dir,e.name),depth+1);
  }
}
for(const r of roots)walk(r);

function scan(root){
  const files=[];
  const scanRoots=['src/app/api/crawl','src/app/crawl','src/lib/crawler','src/lib/actions','chrome-extension'];
  function rec(d){
    if(!fs.existsSync(d))return;
    let ents=[];try{ents=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
    for(const e of ents){
      if(e.name==='node_modules'||e.name==='.next')continue;
      const p=path.join(d,e.name);
      if(e.isDirectory())rec(p);
      else if(/\.(?:js|mjs|cjs|ts|tsx)$/.test(e.name))files.push(p);
    }
  }
  for(const rel of scanRoots)rec(path.join(root,rel));
  const hits=[];
  const patterns=[
    /\/api\/crawl\/[A-Za-z0-9_\-\/]+/g,
    /fetch\([^\n]{0,300}/g,
    /chrome\.runtime\.sendMessage\([^\n]{0,300}/g,
    /chrome\.tabs\.sendMessage\([^\n]{0,300}/g,
    /onMessage\.addListener[^\n]{0,260}/g,
    /(?:START|RUN|BATCH|CRAWL)[A-Z0-9_\-]{2,}/g,
    /batchEngine[^\n]{0,240}/gi,
    /run-complete[^\n]{0,240}/gi,
    /run-start[^\n]{0,240}/gi
  ];
  for(const file of files){
    let s='';try{s=fs.readFileSync(file,'utf8');}catch{continue;}
    for(const re of patterns){
      re.lastIndex=0;
      for(const m of s.matchAll(re)){
        const line=s.slice(0,m.index).split('\n').length;
        hits.push({file:path.relative(root,file).replaceAll('\\','/'),line,text:m[0].slice(0,360)});
      }
    }
  }
  const uniq=[];const seen=new Set();
  for(const h of hits){const k=h.file+'|'+h.line+'|'+h.text;if(!seen.has(k)){seen.add(k);uniq.push(h);}}
  return {
    root,
    version:(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version||null}catch{return null}})(),
    extensionVersion:(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'chrome-extension','manifest.json'),'utf8')).version||null}catch{return null}})(),
    endpoints:[...new Set(uniq.flatMap(h=>h.text.match(/\/api\/crawl\/[A-Za-z0-9_\-\/]+/g)||[]))].sort(),
    messageHits:uniq.filter(h=>/sendMessage|onMessage|START|RUN|BATCH|CRAWL|batchEngine/i.test(h.text)).slice(0,160),
    allHits:uniq.slice(0,400)
  };
}
const reports=candidates.map(c=>scan(c.dir));
const ranked=reports.sort((a,b)=>(Number(Boolean(b.extensionVersion))-Number(Boolean(a.extensionVersion)))||String(b.version||'').localeCompare(String(a.version||''),undefined,{numeric:true}));
const out={generatedAt:new Date().toISOString(),readOnly:true,candidateCount:ranked.length,candidates:ranked};
const outDir=path.join(os.homedir(),'Desktop','pokemon-radar-crawl-storm-diagnose');
fs.mkdirSync(outDir,{recursive:true});
const outFile=path.join(outDir,'crawl-storm-entry-report.json');
fs.writeFileSync(outFile,JSON.stringify(out,null,2),'utf8');
console.log('Saved: '+outFile);
console.log(JSON.stringify(ranked.slice(0,5).map(x=>({root:x.root,version:x.version,extensionVersion:x.extensionVersion,endpoints:x.endpoints,messageHits:x.messageHits.slice(0,12)})),null,2));
