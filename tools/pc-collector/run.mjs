import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// No scheduler, startup registration, purchases or invitation requests.
const root=fileURLToPath(new URL('../../',import.meta.url));
process.chdir(root);
function command(exe,args,options={}){
 const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',stdio:'inherit',...options});
 if(r.error)throw r.error;
 if(r.status!==0)throw new Error(`${exe} failed (${r.status}). Publication stopped.`);
 return r.stdout;
}
try{
 command('git',['rev-parse','--is-inside-work-tree']);
 const branch=command('git',['branch','--show-current'],{stdio:'pipe'}).trim();
 if(branch!=='main')throw new Error('Use a dedicated checkout on main.');
 const dirty=command('git',['status','--porcelain','--untracked-files=no'],{stdio:'pipe'}).trim();
 if(dirty)throw new Error('Tracked files have local changes. No files were overwritten.');
 command('gh',['auth','status']);
 command('git',['pull','--ff-only','origin','main']);
 const evidence=fs.mkdtempSync(path.join(os.tmpdir(),'pokemon-radar-pc-'));
 console.log('Evidence folder:',evidence);
 const failures=[];
 try{command(process.execPath,['tools/amazon-browser-probe/update-live.mjs','all',path.join(evidence,'amazon'),'data/snapshot.json','data/internal/amazon-asin-pool.json']);}
 catch(e){failures.push('Amazon');console.error(e.message);}
 try{
  command(process.execPath,['tools/rakutenbooks/collect.mjs','all',path.join(evidence,'rakutenbooks')]);
  command(process.execPath,['tools/rakutenbooks/collect.mjs','adopt',path.join(evidence,'rakutenbooks'),'data/snapshot.json']);
 }catch(e){failures.push('Rakuten Books');console.error(e.message);}
 // Both collectors retain the previous snapshot when official verification fails.
 command('git',['add','--','data/snapshot.json','data/internal/amazon-asin-pool.json']);
 const diff=spawnSync('git',['diff','--cached','--quiet'],{cwd:root});
 if(diff.status===1){
  command('git',['-c','user.name=Pokemon Radar PC','-c','user.email=pokemon-radar-pc@users.noreply.github.com','commit','-m','Publish verified results from PC collectors']);
  // No force push or automatic conflict resolution. A concurrent update rejects publication.
  command('git',['-c','credential.helper=','-c','credential.helper=!gh auth git-credential','push','origin','HEAD:main']);
  console.log('Results sent to GitHub. Pages deployment must finish before mobile reflects them.');
 }else if(diff.status===0)console.log('No saved result changes.');
 else throw new Error('Could not inspect publication diff.');
 if(failures.length){console.error('INCOMPLETE:',failures.join(', '));process.exitCode=10;}
 else console.log('Collection and publication steps finished. Check official results and Pages deployment.');
}catch(e){console.error(e.message);process.exitCode=1;}
