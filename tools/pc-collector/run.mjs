import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {reserveDay,publicHasCases} from './checks.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
process.chdir(root);
const stateDir=path.join(process.env.LOCALAPPDATA||os.homedir(),'PokemonRadarCollector');
fs.mkdirSync(stateDir,{recursive:true});
const reportPath=path.join(stateDir,'last-result.json');
const report={startedAt:new Date().toISOString(),environment:'PC_VISIBLE',amazon:{status:'NOT_ATTEMPTED'},rakuten:{status:'NOT_ATTEMPTED'},publication:'NOT_ATTEMPTED',errors:[]};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function command(exe,args,options={}){
 const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',stdio:'inherit',env:{...process.env,RADAR_PC_VISIBLE:'1'},...options});
 if(r.error)throw r.error;
 if(r.status!==0)throw new Error(exe+' failed ('+r.status+').');
 return r.stdout;
}
let saveReport=true;
try{
 command('git',['rev-parse','--is-inside-work-tree']);
 const origin=command('git',['remote','get-url','origin'],{stdio:'pipe'}).trim();
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)yasuyasu55\/pokemon-radar-mobile(?:\.git)?$/.test(origin))throw new Error('Unexpected origin. Use a dedicated official checkout.');
 if(command('git',['branch','--show-current'],{stdio:'pipe'}).trim()!=='main')throw new Error('Use a dedicated checkout on main.');
 if(command('git',['status','--porcelain','--untracked-files=no'],{stdio:'pipe'}).trim())throw new Error('Local tracked changes exist. No files were overwritten.');
 command('gh',['auth','status']);
 command('git',['pull','--ff-only','origin','main']);
 if(!reserveDay(path.join(stateDir,'daily'))){saveReport=false;console.log('Already attempted today (JST). Previous report: '+reportPath);}
 else{
 const prior=read('data/snapshot.json');
 const evidence=fs.mkdtempSync(path.join(stateDir,'run-'));report.evidence=evidence;
 console.log('Visible browser will check product pages. Do not click invitation or purchase buttons.');
 try{
  command(process.execPath,['tools/amazon-browser-probe/update-live.mjs','all',path.join(evidence,'amazon'),'data/snapshot.json','data/internal/amazon-asin-pool.json']);
  report.amazon={status:'FINISHED'};
 }catch(e){report.amazon={status:'FAILED',error:e.message};report.errors.push('Amazon acquisition incomplete');}
 const statusPath=path.join(evidence,'amazon','status.json');
 if(fs.existsSync(statusPath))report.amazon={...report.amazon,...read(statusPath)};
 try{
  command(process.execPath,['tools/rakutenbooks/collect.mjs','all',path.join(evidence,'rakutenbooks')]);
  command(process.execPath,['tools/rakutenbooks/collect.mjs','adopt',path.join(evidence,'rakutenbooks'),'data/snapshot.json']);
  report.rakuten={status:'VERIFIED'};
 }catch(e){report.rakuten={status:'FAILED',error:e.message};report.errors.push('Rakuten acquisition incomplete');}
 const after=read('data/snapshot.json'),old=new Map(prior.cases.map(c=>[c.id,c]));
 const expected=after.cases.filter(c=>JSON.stringify(old.get(c.id))!==JSON.stringify(c));
 report.changedCases=expected.map(c=>({id:c.id,title:c.title,fetchedAt:c.fetchedAt,newId:!old.has(c.id)}));
 command('git',['add','--','data/snapshot.json','data/internal/amazon-asin-pool.json']);
 const diff=spawnSync('git',['diff','--cached','--quiet'],{cwd:root});
 if(diff.status===1){
  command('git',['-c','user.name=Pokemon Radar PC','-c','user.email=pokemon-radar-pc@users.noreply.github.com','commit','-m','Publish verified results from PC collectors']);
  // A concurrent update rejects the push. Never force or silently resolve conflicts.
  command('git',['-c','credential.helper=','-c','credential.helper=!gh auth git-credential','push','origin','HEAD:main']);
  report.publication='SENT_NOT_CONFIRMED';
  if(expected.length){
   for(let i=0;i<5;i++){
    if(i)await new Promise(r=>setTimeout(r,15000));
    try{const r=await fetch('https://yasuyasu55.github.io/pokemon-radar-mobile/data/snapshot.json',{cache:'no-store',signal:AbortSignal.timeout(15000)});
     if(r.ok&&publicHasCases(await r.json(),expected)){report.publication='PUBLIC_RESULTS_CONFIRMED';break;}}
    catch{}
   }
   if(report.publication!=='PUBLIC_RESULTS_CONFIRMED')report.errors.push('Public reflection not confirmed. Check Pages deployment.');
  }else report.publication='POOL_ONLY_NO_CASE_UPDATE';
 }else if(diff.status===0)report.publication='NO_CHANGE';
 else throw new Error('Could not inspect publication diff.');
 if(report.errors.length)process.exitCode=10;
 }
}catch(e){report.errors.push(e.message);process.exitCode=1;}
finally{
 if(saveReport){report.finishedAt=new Date().toISOString();fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
 console.log('Result file: '+reportPath);
 if(saveReport)console.log(JSON.stringify(report,null,2));
}

