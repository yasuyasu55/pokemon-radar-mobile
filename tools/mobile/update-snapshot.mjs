import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSnapshot} from './build-snapshot.mjs';

// A successful scan of ONE list page is not proof that the shop has no lotteries.
// This path never builds or writes a replacement public snapshot.
export function assessEmptyList(a,b,comparison){
  if(![a,b].some(r=>r.verdict==='NO_CANDIDATE_IN_LIST')) return null;
  const official='https://www.otakarasouko.com/new_information/';
  for(const r of [a,b]){
    const list=r.list;
    const ledger=(r.ledger||[]).find(x=>x.stage==='list');
    if(r.env?.mode!=='LIVE'||!Number.isInteger(r.env?.pid)||r.env.pid<=0||
      r.verdict!=='NO_CANDIDATE_IN_LIST'||r.extractionVerdict?.level!=='NOT_EVALUATED'||
      !Array.isArray(r.candidates)||r.candidates.length!==0||r.counts?.candidates!==0||
      !Array.isArray(r.failures)||r.failures.length||
      r.source?.sourceId!=='otakarasouko-group'||r.source?.listUrl!==official||
      list?.url!==official||!Number.isInteger(list.itemsParsed)||list.itemsParsed<=0||
      !Array.isArray(list.targets)||list.targets.length||!Array.isArray(list.skippedByDetailCap)||list.skippedByDetailCap.length||
      list.detailPathAllowedByRobots!==true||!Array.isArray(list.excluded)||list.excluded.length!==list.itemsParsed||
      list.excluded.some(x=>!x.title?.trim()||!x.reason?.trim()||!/^https:\/\/www\.otakarasouko\.com\/information\/\d+\/$/.test(x.url))||
      ledger?.ok!==true||ledger.status!==200||ledger.requestedUrl!==official||!ledger.normalizedTextSha256){
      throw new Error('候補なしを正常な一覧確認として扱うための証跡が不足しています');
    }
  }
  const normalize=r=>JSON.stringify(r.list.excluded.map(({url,title,reason})=>({url,title,reason})).sort((x,y)=>x.url.localeCompare(y.url)));
  if(a.env.pid===b.env.pid||comparison?.overall!=='CONSISTENT'||normalize(a)!==normalize(b)) throw new Error('候補なしの独立2回の一覧結果が一致しません');
  return {status:'NO_CANDIDATE_IN_SCANNED_LIST',changed:false,checkedAt:b.finishedAt,listUrl:official,
    scope:'一覧1ページのみ。店舗全体の募集なしを意味しない',excludedCount:b.list.excluded.length,
    retainedPrevious:true};
}

export function mergeSnapshot(previous, fresh) {
  if(previous.schemaVersion!==1 || previous.sourceId!==fresh.sourceId || !Array.isArray(previous.cases)) throw new Error('保存済みデータの形式・情報源が一致しません');
  const ids=new Set();
  for(const c of fresh.cases){
    if(!c.id || ids.has(c.id) || !/^https:\/\/www\.otakarasouko\.com\/information\/\d+\/$/.test(c.sourceUrl)) throw new Error('案件ID・公式URLが不正です');
    ids.add(c.id);
  }
  // 一覧から消えたことを終了・削除の根拠にしない。最後の確認値を保持する。
  const retained=previous.cases.filter(c=>!ids.has(c.id)).map(c=>({...c,retainedFromPrevious:true}));
  return {...fresh,sources:previous.sources??{},cases:[...fresh.cases,...retained],retainedCount:retained.length};
}

export function updateSnapshot(resultDir, target) {
  const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
  const a=read(path.join(resultDir,'run-1/result.json')),b=read(path.join(resultDir,'run-2/result.json')),comparison=read(path.join(resultDir,'compare.json'));
  const empty=assessEmptyList(a,b,comparison);
  if(empty){
    const previous=read(target);
    if(previous.schemaVersion!==1||!Array.isArray(previous.cases)) throw new Error('保存済みデータの形式が不正です');
    return {...previous,updateOutcome:empty};
  }
  const fresh=buildSnapshot(a,b,comparison);
  const next=mergeSnapshot(read(target),fresh);
  // 検証がすべて通るまで出力先に触れない。
  fs.writeFileSync(target+'.tmp',JSON.stringify(next,null,2)+'\n');
  fs.renameSync(target+'.tmp',target);
  return next;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [resultDir,target,reportPath]=process.argv.slice(2);
  if(!resultDir||!target) throw new Error('引数: 結果フォルダ snapshot.json');
  const next=updateSnapshot(resultDir,target);
  const report=next.updateOutcome||{status:'VERIFIED_UPDATE',changed:true};
  if(reportPath) fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  if(report.changed) console.log(`実取得・照合済み ${next.cases.length-next.retainedCount}件 / 前回保持 ${next.retainedCount}件`);
  else console.log('::warning title=Otakara list scan found no candidates::確認した一覧1ページに対象候補なし。公開案件・最終確認日時は変更していません。店舗全体の募集なしを意味しません。');
  console.log(JSON.stringify(report));
}

