// ブランチ更新で起動する既存のPages配信を確認する。別の配信を重ねない。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function selectPagesRun(runs,sha){return runs.find(r=>r.head_sha===sha&&r.name==='pages build and deployment');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [sha,target]=process.argv.slice(2),repo=process.env.GITHUB_REPOSITORY;
 if(!sha||!target||!repo)throw new Error('公開確認の引数が不足しています');
 const expected=fs.readFileSync(target,'utf8');
 const url='https://yasuyasu55.github.io/pokemon-radar-mobile/data/snapshot.json';
 let last='Pages実行待ち';
 for(let i=0;i<30;i++){
  const response=await fetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${process.env.GH_TOKEN}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Pages確認API: HTTP ${response.status}`);
  const run=selectPagesRun((await response.json()).workflow_runs,sha);
  if(run?.status==='completed'){
   if(run.conclusion!=='success')throw new Error(`Pages配信失敗: ${run.conclusion}`);
   const publicResponse=await fetch(`${url}?run=${process.env.GITHUB_RUN_ID}&check=${i}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(publicResponse.ok&&(await publicResponse.text())===expected){console.log(`Pages配信成功・公開スナップショット完全一致: ${run.html_url}`);process.exit(0);}
   last='Pages成功後の公開データ反映待ち';
  }else last=`Pages実行: ${run?.status??'待機中'}`;
  await new Promise(r=>setTimeout(r,10000));
 }
 throw new Error(`公開確認の待機上限: ${last}`);
}
