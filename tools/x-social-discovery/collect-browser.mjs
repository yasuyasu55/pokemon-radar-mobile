import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {BROWSER_HANDLES,normalizeVisiblePosts,ingestVisiblePosts} from './browser-candidates.mjs';

const directory=process.argv[2]||'data/internal';
const stateDir=path.join(process.env.LOCALAPPDATA||os.homedir(),'PokemonRadarCollector');
const read=(p,fallback)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2)+'\n');fs.renameSync(p+'.tmp',p);};
const report={checkedAt:new Date().toISOString(),method:'pc-chrome-visible',coverage:'VISIBLE_SAMPLE_ONLY',publication:'candidate-only',accounts:[]};
let context;
try{
 const {chromium}=await import('playwright');
 // Dedicated profile only. Never copy cookies/passwords from another Chrome profile.
 context=await chromium.launchPersistentContext(path.join(stateDir,'x-chrome-profile'),{channel:'chrome',headless:false});
 const posts=[];
 for(const handle of BROWSER_HANDLES){
  const page=await context.newPage();
  try{
   await page.goto('https://x.com/'+handle,{waitUntil:'domcontentloaded',timeout:30000});
   const cards=page.locator('article');
   await cards.first().waitFor({state:'visible',timeout:20000});
   // Only read the first rendered sample. No login automation, scrolling loops or hidden APIs.
   const more=page.getByRole('button',{name:/^(Show more|さらに表示)$/});
   for(let i=0,n=Math.min(await more.count(),8);i<n;i++){
    const button=more.first();if(await button.isVisible())await button.click({timeout:2000});else break;
   }
   const rows=await cards.evaluateAll(es=>es.slice(0,20).map(e=>{
    const root=e.closest('[data-href]')||e;
    const status=e.querySelector('a[href*="/status/"]');
    return {url:root.getAttribute('data-href')||status?.getAttribute('href'),text:e.innerText,postedAt:e.querySelector('time')?.getAttribute('datetime')||null,
     urls:[...e.querySelectorAll('a[href]')].flatMap(a=>[a.getAttribute('title'),a.getAttribute('href')]).filter(x=>x?.startsWith('https://'))};
   }));
   const found=normalizeVisiblePosts(handle,rows);posts.push(...found);
   report.accounts.push({handle,status:found.length?'VISIBLE_SAMPLE':'NO_POSTS_UNCONFIRMED',posts:found.length});
  }catch(e){report.accounts.push({handle,status:'UNAVAILABLE',posts:0,error:e.name});}
  finally{await page.close();}
 }
 if(posts.length){
  const next=await ingestVisiblePosts(posts,read(path.join(directory,'x-candidates.json'),{}),read(path.join(directory,'amazon-asin-pool.json'),{items:[]}));
  save(path.join(directory,'x-candidates.json'),next.candidates);save(path.join(directory,'amazon-asin-pool.json'),next.pool);report.counts=next.counts;
 }
 report.status=report.accounts.every(a=>a.status==='VISIBLE_SAMPLE')?'SAMPLE_COLLECTED_NOT_FULL_MONITORING':'PARTIAL_OR_UNAVAILABLE';
}catch(e){report.status='BROWSER_UNAVAILABLE';report.error=e.name;}
finally{await context?.close();save(path.join(directory,'x-browser-status.json'),report);console.log(JSON.stringify(report));}
if(report.status!=='SAMPLE_COLLECTED_NOT_FULL_MONITORING')process.exitCode=10;
