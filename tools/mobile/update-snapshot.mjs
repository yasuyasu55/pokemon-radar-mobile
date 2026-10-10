import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSnapshot} from './build-snapshot.mjs';

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
  const fresh=buildSnapshot(read(path.join(resultDir,'run-1/result.json')),read(path.join(resultDir,'run-2/result.json')),read(path.join(resultDir,'compare.json')));
  const next=mergeSnapshot(read(target),fresh);
  // 検証がすべて通るまで出力先に触れない。
  fs.writeFileSync(target+'.tmp',JSON.stringify(next,null,2)+'\n');
  fs.renameSync(target+'.tmp',target);
  return next;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [resultDir,target]=process.argv.slice(2);
  if(!resultDir||!target) throw new Error('引数: 結果フォルダ snapshot.json');
  const next=updateSnapshot(resultDir,target);
  console.log(`実取得・照合済み ${next.cases.length-next.retainedCount}件 / 前回保持 ${next.retainedCount}件`);
}
