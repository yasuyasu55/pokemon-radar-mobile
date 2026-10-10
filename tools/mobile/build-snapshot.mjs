import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function buildSnapshot(a, b, comparison) {
  for (const r of [a, b]) {
    if (r.env?.mode !== 'LIVE' || r.verdict !== 'OK' || r.extractionVerdict?.level !== 'COMPLETE' || !Array.isArray(r.candidates)) throw new Error('実取得・正常完了・抽出検証済みの結果が必要です');
    if (r.list?.skippedByDetailCap?.length) throw new Error('取得上限により未確認の記事があります');
    if (!r.candidates.length) throw new Error('空の結果で前回データを置き換えません');
    if (r.failures?.length) throw new Error('取得失敗が含まれています');
    for (const c of r.candidates) if (c.verification?.overall !== 'OK' || c.completeness?.level !== 'COMPLETE') throw new Error('候補の検証に未完了があります');
  }
  if (a.env.pid === b.env.pid || comparison.overall !== 'CONSISTENT') throw new Error('独立した2回の照合が必要です');
  const select = c => ({
    id:c.id, title:c.fields.title, sourceName:'お宝創庫グループ', sourceUrl:c.url,
    fetchedAt:c.fetchedAt, publishedDate:c.fields.postedDate.value,
    entryPeriod:c.fields.entryPeriod.value, resultAnnouncement:c.fields.resultAnnouncement.value,
    purchasePeriod:{...c.fields.purchasePeriod.value, timeQualifier:c.fields.purchasePeriod.timeQualifier},
    applicationMethod:c.display.entryMethodLabel, webApplicationUrl:c.fields.entryMethod.webEntryUrl,
    webApplicationLabel:c.display.webEntryUrlLabel,
    receivingMethod:c.fields.receiving.method, receivingLabel:c.display.receivingLabel,
    stores:c.fields.selectableStores.stores.map(s=>({brand:s.brand,name:s.name,address:null,prefecture:null})),
    storeSelectionNote:c.fields.selectableStores.selection.evidence,
    conditions:c.fields.eligibilityConditions.items.map(x=>x.text),
    handoverRestrictions:c.fields.handoverRestrictions,
    prices:c.fields.products.map(x=>({label:x.raw,amountYen:x.amountYen})),
    unknowns:['店舗の所在地・営業時間','あなたの会員資格・利用履歴','応募時に選択した受取店舗','1人あたりの応募上限'],
    evidence:{entry:c.fields.entryPeriod.evidence.quote,result:c.fields.resultAnnouncement.evidence.quote,purchase:c.fields.purchasePeriod.evidence.quote,receiving:c.fields.receiving.evidence},
    verification:'独立2回の実取得・必須項目の抽出を照合済み'
  });
  const ca=a.candidates.map(select), cb=b.candidates.map(select);
  const normalized = cs=>JSON.stringify(cs.map(({fetchedAt,...c})=>c).sort((x,y)=>x.id.localeCompare(y.id)));
  if(normalized(ca)!==normalized(cb)) throw new Error('表示対象の抽出値が2回で一致しません');
  return {schemaVersion:1,appVersion:'0.1.11',sourceId:'otakarasouko-group',evidenceRunId:a.env.runner?.details?.runId??null,fetchedAt:b.finishedAt,
    updateMode:'毎日7:17ごろ（日本時間）に自動更新・検証失敗時は前回データを保持', liveRunsVerified:2, fetchEvidence:[a,b].map(r=>({startedAt:r.startedAt,finishedAt:r.finishedAt,requests:(r.ledger??[]).map(e=>({stage:e.stage,url:e.requestedUrl,finalUrl:e.finalUrl,status:e.status,bytes:e.bytes,sha256:e.sha256,contentType:e.headers?.['content-type']??null}))})), cases:cb};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [first,second,compare]=process.argv.slice(2);
  if(!first||!second||!compare) throw new Error('引数: run-1/result.json run-2/result.json compare.json');
  const data=buildSnapshot(...[first,second,compare].map(p=>JSON.parse(fs.readFileSync(p,'utf8'))));
  const out=path.join(root,'mobile/data/snapshot.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out+'.tmp',JSON.stringify(data,null,2)+'\n'); fs.renameSync(out+'.tmp',out);
  console.log(`確認済み ${data.cases.length}件を出力: ${out}`);
}
