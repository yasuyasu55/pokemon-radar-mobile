import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compare} from './collect.mjs';

// Attempt metadata never replaces cases or advances the last successful source timestamp.
export function recordAttempt(previous,runs,{checkedAt,runUrl}={}){
 if(previous.schemaVersion!==1||!Array.isArray(previous.cases)||!runs.length)throw new Error('取得結果がありません');
 const failed=runs.find(r=>!r.ok);
 let verified=false;
 if(!failed&&runs.length===2){try{compare(...runs);verified=true;}catch{}}
 const last=failed??runs.at(-1);
 const blocked=last.ledger?.find(r=>r.errorKind==='REDIRECT_BLOCKED');
 const redirectHost=blocked?new URL(blocked.finalUrl).hostname:null;
 const lastAttempt={
  checkedAt:checkedAt??last.finishedAt??new Date().toISOString(),
  status:verified?'VERIFIED':blocked?'REDIRECT_BLOCKED':'FAILED',
  message:verified?'独立2回の取得・照合成功':blocked?'別ホストへの転送で取得停止。募集状況は未確認':last.error??'独立2回の照合が成立していません',
  stage:last.stage??(verified?'VERIFY':'COMPARE'),
  ...(redirectHost?{redirectHost}:{}),
  ...(runUrl?{runUrl}:{}),
  ...(verified?{verifiedCases:last.cases.length}:{})
 };
 return {...previous,sources:{...previous.sources,pokemoncenter:{name:'ポケモンセンターオンライン',...previous.sources?.pokemoncenter,lastAttempt}}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [target,file]=process.argv.slice(2);
 const runs=[1,2].map(i=>path.join(target,'run-'+i,'result.json')).filter(f=>fs.existsSync(f)).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
 const next=recordAttempt(JSON.parse(fs.readFileSync(file,'utf8')),runs,{runUrl:process.env.GITHUB_SERVER_URL&&process.env.GITHUB_REPOSITORY&&process.env.GITHUB_RUN_ID?`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:undefined});
 fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(file+'.tmp',file);
 const a=next.sources.pokemoncenter.lastAttempt;
 console.log(JSON.stringify(a));
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### ポケモンセンター取得状況\n\n${a.message}\n\n確認: ${a.checkedAt}\n\n案件の最終反映: ${next.sources.pokemoncenter.fetchedAt??'未記録'}\n`);
}
