import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAmazon} from '../tools/amazon-dryrun/extract.mjs';
import {discoverAmazonAsins,mergeDiscovered,searchUrl} from '../tools/amazon-dryrun/discover.mjs';
import {compareRuns, summarizeObservations} from '../tools/amazon-dryrun/cli.mjs';
import fs from 'node:fs';
const asin='B0FSJXSPPX';
// Synthetic structure tests, not an assertion of live Amazon acquisition.
const title='<span id="productTitle">ポケモンカードゲーム MEGA 拡張パック ムニキスゼロ BOX</span>';
const box=`<div id="hdp_buybox_desktop"><div data-csa-c-asin="${asin}"><div id="hdp-detail-no-requested-id">本商品は招待販売としております。</div><div id="hdp-invite-button"><input name="submit.inviteButton" value="招待をリクエストする"></div><div>出荷元 / 販売元</div><div>Amazon.co.jp</div></div></div>`;
const extract=h=>extractAmazon(h,asin);
test('対象商品・Amazon販売元・招待欄・操作を同時に確認',()=>{const c=extract(title+box);assert.equal(c.candidate,true);assert.equal(c.kind,'INVITATION_SALE');assert.equal(c.deadline,null);assert.equal(c.receivingMethod,'UNKNOWN');});
test('説明欄と関連商品の招待語だけでは候補にしない',()=>{assert.equal(extract(title+'<div>招待をリクエストする 招待販売</div>').candidate,false);});
test('中古欄と商品説明の招待文が混在しても受付中にしない',()=>{const c=extract(title+'<div id="used_buybox_desktop">カートに入れる</div><div>招待リクエストについて</div>');assert.equal(c.requestStatus,'UNKNOWN');assert.match(c.reason,/中古/);});
test('他商品のASIN・第三者販売元を採用しない',()=>{assert.equal(extract(title+box.replace(asin,'B0F18J2CJF')).candidate,false);assert.equal(extract(title+box.replace('Amazon.co.jp','他の出品者')).candidate,false);});
test('無効ボタンとnoscriptの代替ボタンは採用しない',()=>{assert.equal(extract(title+box.replace('<input ','<input disabled ')).candidate,false);assert.equal(extract(title+box.replace('<input name="submit.inviteButton" value="招待をリクエストする">','<noscript><input name="submit.inviteButton" value="招待をリクエストする"></noscript>')).candidate,false);});
test('非表示の購入欄・販売元・ボタンを採用しない',()=>{for(const h of [box.replace('id="hdp_buybox_desktop"','id="hdp_buybox_desktop" style="display:none"'),box.replace('id="hdp-invite-button"','id="hdp-invite-button" hidden'),box.replace('<div>Amazon.co.jp</div>','<div style="display:none">Amazon.co.jp</div>')])assert.equal(extract(title+h).candidate,false);});
test('コメント・script内の偽購入欄を採用しない',()=>{for(const h of [`<!--${box}-->`,`<script>${box}</script>`])assert.equal(extract(title+h).candidate,false);});
test('オリパと構造変更・エラー画面は採用しない',()=>{assert.equal(extract((title+box).replace('ムニキスゼロ','オリパ')).candidate,false);assert.equal(extract('Service Unavailable').candidate,false);assert.equal(extract(title+box.replaceAll('hdp_buybox_desktop','new_layout')).candidate,false);});
test('説明文の12か月を締切・応募済みに変換しない',()=>{const c=extract(title+box+'招待リクエストは12か月間有効です。招待をリクエストいただきありがとうございます。');assert.equal(c.deadline,null);assert.equal(c.requestStatus,'REQUEST_CONTROL_PRESENT');assert.equal('applied' in c,false);});
const run=pid=>({mode:'LIVE',extractorVersion:'test',pid,acquisitionVerdict:'OK',observations:['B0FSJXSPPX','B0F18J2CJF'].map(asin=>({asin,sha256:'same',extraction:{kind:'UNKNOWN'}}))});
test('2回の同じ抽出・本文差を分離し、採用は無効のまま',()=>{const a=run(1),b=run(2);b.observations[0].sha256='changed';const c=compareRuns(a,b);assert.equal(c.overall,'CONSISTENT');assert.equal(c.rows.find(r=>r.asin==='B0FSJXSPPX').bodySame,false);assert.equal(c.adoption,'NOT_ENABLED');});
test('同一プロセス・取得失敗・抽出器の版差は照合成功にしない',()=>{for(const b of [{...run(2),pid:1},{...run(2),acquisitionVerdict:'FAILED'},{...run(2),extractorVersion:'other'}])assert.equal(compareRuns(run(1),b).overall,'NOT_VERIFIED');});
test('抽出差・対象不足を検出',()=>{const b=run(2);b.observations[0].extraction.kind='INVITATION_SALE';assert.equal(compareRuns(run(1),b).overall,'DIFFERENT');b.observations=[];assert.equal(compareRuns(run(1),b).overall,'DIFFERENT');});
test('Amazon検証にはschedule・書込み・公開工程がない',()=>{const w=fs.readFileSync(new URL('../.github/workflows/amazon-probe.yml',import.meta.url),'utf8');assert.match(w,/contents: read/);assert.doesNotMatch(w,/schedule:|contents: write|git push|deploy-pages|update-snapshot/);});
test('HTTP200でも商品が読めなければ候補数を0件にしない',()=>{const observations=['B0FSJXSPPX','B0F18J2CJF'].map(asin=>({asin,stage:'UNEXPECTED_RESPONSE',extraction:{candidate:false}}));assert.deepEqual(summarizeObservations(observations),{acquisitionVerdict:'FAILED',candidateCount:null});assert.equal(summarizeObservations([]).candidateCount,null);});

test('Amazon検索結果は候補ASIN発見だけを行い、案件確定しない',()=>{
 const html='<div data-asin="B0AAAAAAAA"><h2>ポケモンカードゲーム テストBOX</h2></div><a href="/dp/B0BBBBBBBB">Pokemon Card Sample</a><div data-asin="B0CCCCCCCC">一般商品</div>';
 const items=discoverAmazonAsins(html);
 assert.deepEqual(items.map(x=>x.asin),['B0AAAAAAAA','B0BBBBBBBB']);
 for(const x of items)assert.equal('candidate' in x,false);
});
test('複数検索語のASINを重複排除し検索語を保持',()=>{
 const m=mergeDiscovered([{query:'ポケモンカード 抽選',items:[{asin:'B0AAAAAAAA',label:'ポケモンカード',source:'x'}]},{query:'ポケモンカード 招待',items:[{asin:'B0AAAAAAAA',label:'ポケモンカード',source:'x'},{asin:'B0BBBBBBBB',label:'ポケモンカード',source:'x'}]}]);
 assert.deepEqual(m.map(x=>x.asin),['B0AAAAAAAA','B0BBBBBBBB']);
 assert.deepEqual(m[0].queries,['ポケモンカード 抽選','ポケモンカード 招待']);
 assert.match(searchUrl('ポケモンカード 抽選'),/^https:\/\/www\.amazon\.co\.jp\/s\?k=/);
});
