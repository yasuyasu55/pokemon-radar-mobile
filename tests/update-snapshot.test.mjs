// 人工データで採用・保存の境界を検証する。実取得の証拠には数えない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildSnapshot} from '../tools/mobile/build-snapshot.mjs';
import {mergeSnapshot,updateSnapshot} from '../tools/mobile/update-snapshot.mjs';
const candidate={id:'otakarasouko:1',url:'https://www.otakarasouko.com/information/1/',fetchedAt:'2026-10-10T12:00:00Z',verification:{overall:'OK'},completeness:{level:'COMPLETE'},
 fields:{title:'人工検証用抽選',postedDate:{value:null},entryPeriod:{value:{},evidence:{quote:'人工応募期間'}},resultAnnouncement:{value:{},evidence:{quote:'人工結果'}},purchasePeriod:{value:{},evidence:{quote:'人工購入期間'}},entryMethod:{webEntryUrl:null},receiving:{method:'STORE_ONLY',evidence:[]},selectableStores:{stores:[{brand:'ブランド',name:'店舗'}],selection:{evidence:'応募時に選択'}},eligibilityConditions:{items:[]},handoverRestrictions:[],products:[]},
 display:{entryMethodLabel:'公式アプリ',webEntryUrlLabel:'なし',receivingLabel:'店頭受取のみ'}};
const run=pid=>({env:{mode:'LIVE',pid},verdict:'OK',extractionVerdict:{level:'COMPLETE'},candidates:[structuredClone(candidate)],failures:[],finishedAt:'2026-10-10T12:01:00Z',list:{skippedByDetailCap:[]}});
const comparison={overall:'CONSISTENT'};
test('独立2回の完全成功だけ採用する',()=>{assert.equal(buildSnapshot(run(1),run(2),comparison).cases.length,1);});
for(const [label,change] of Object.entries({
  '取得失敗':r=>r.verdict='PARTIAL',
  '再生データ':r=>r.env.mode='REPLAY',
  '抽出不完全':r=>r.extractionVerdict.level='INCOMPLETE',
  '候補検証失敗':r=>r.candidates[0].verification.overall='NG',
  '失敗あり':r=>r.failures.push({stage:'detail'}),
  '取得上限で未確認':r=>r.list.skippedByDetailCap.push({url:'unseen'}),
  '空結果':r=>r.candidates=[],
}))test(label+'で既存ファイルを変更しない',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-update-'));
 try{
  fs.mkdirSync(path.join(dir,'run-1'));fs.mkdirSync(path.join(dir,'run-2'));
  const bad=run(1);change(bad);
  fs.writeFileSync(path.join(dir,'run-1/result.json'),JSON.stringify(bad));
  fs.writeFileSync(path.join(dir,'run-2/result.json'),JSON.stringify(run(2)));
  fs.writeFileSync(path.join(dir,'compare.json'),JSON.stringify(comparison));
  const target=path.join(dir,'snapshot.json');fs.writeFileSync(target,'previous bytes');
  assert.throws(()=>updateSnapshot(dir,target));assert.equal(fs.readFileSync(target,'utf8'),'previous bytes');assert.equal(fs.existsSync(target+'.tmp'),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('同一プロセス・比較不一致・表示値不一致を拒否',()=>{
 assert.throws(()=>buildSnapshot(run(1),run(1),comparison));
 assert.throws(()=>buildSnapshot(run(1),run(2),{overall:'DIFFERENCES'}));
 const b=run(2);b.candidates[0].fields.title='別値';assert.throws(()=>buildSnapshot(run(1),b,comparison));
});
test('一覧から消えた案件は前回値と取得日時を保持',()=>{
 const fresh=buildSnapshot(run(1),run(2),comparison);
 const old={id:'otakarasouko:2',title:'前回案件',fetchedAt:'2026-10-09T00:00:00Z'};
 const previous={...fresh,cases:[{...fresh.cases[0],title:'更新前'},old]};
 const next=mergeSnapshot(previous,fresh);
 assert.equal(next.cases.length,2);assert.equal(next.cases[0].title,candidate.fields.title);
 assert.deepEqual(next.cases[1],{...old,retainedFromPrevious:true});assert.equal(next.retainedCount,1);
 assert.equal(previous.cases[0].title,'更新前');
});
test('情報源違い・重複ID・外部URLを拒否',()=>{
 const fresh=buildSnapshot(run(1),run(2),comparison);
 assert.throws(()=>mergeSnapshot({...fresh,sourceId:'other'},fresh));
 assert.throws(()=>mergeSnapshot(fresh,{...fresh,cases:[...fresh.cases,...fresh.cases]}));
 assert.throws(()=>mergeSnapshot(fresh,{...fresh,cases:[{...fresh.cases[0],sourceUrl:'https://example.com/'}]}));
});
test('公開経路を重ねず、検証後に公開結果を確認する',()=>{
 const yaml=fs.readFileSync(new URL('../.github/workflows/update-otakara.yml',import.meta.url),'utf8');
 assert.match(yaml,/wait-publication.mjs/);assert.match(yaml,/persist-credentials: false/);
 assert.doesNotMatch(yaml,/deploy-pages@|upload-artifact@/);
});
