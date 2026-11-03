import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {BROWSER_HANDLES,normalizeVisiblePosts,ingestVisiblePosts} from './browser-candidates.mjs';
import {readVisibleAccount} from './read-visible.mjs';

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
   const result=await readVisibleAccount(page,handle);
   if(result.error){report.accounts.push({handle,status:'UNAVAILABLE',posts:0,error:result.error,stage:result.stage});continue;}
   const rows=result.rows;
   const found=normalizeVisiblePosts(handle,rows);posts.push(...found);
   report.accounts.push({handle,status:found.length?'VISIBLE_SAMPLE':'NO_POSTS_UNCONFIRMED',posts:found.length,expansionIncomplete:result.expansionIncomplete});
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
