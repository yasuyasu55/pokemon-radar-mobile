import test from 'node:test';
import assert from 'node:assert/strict';
import {discover,extractCase,extractEntryCases,compare,merge,mergeOfficialCases,collect,ENTRY,SEARCH,MAX_DETAILS} from '../tools/rakutenbooks/collect.mjs';
import {entryState,matches} from '../model.mjs';

const detail=(id='18595282',title='ポケモンカードゲーム MEGA 拡張パック 30th CELEBRATION')=>`<!doctype html><html><head><title>${title} - 楽天ブックス</title></head><body><h1>${title}</h1>
<h4>【抽選商品について】</h4><h5>■抽選販売スケジュール</h5>
<p>抽選受付期間：2026/08/27(木) 10:00 〜 2026/08/30(日) 23:59</p>
<p>当選者販売期間：2026/09/14(月) 10:00 〜 2026/09/18(金) 09:59</p>
<p>発送予定日：2026年09月中旬発送</p>
<p>※当落の結果は、販売開始日までにメールでご連絡します。</p>
<h5>■抽選に関する注意事項</h5><p>エントリー時の会員情報のご住所と異なるお届け先住所でのご注文は承ることができません。</p>
<p>支払い方法、配送方法についてご確認ください。</p></body></html>`;

function fakeFetcher(pages){
 const calls=[];
 const fetcher=async url=>{calls.push(url);const html=pages[url];return {ok:html!==undefined,status:html===undefined?503:200,requestedUrl:url,headers:{'content-type':'text/html; charset=utf-8'},body:Buffer.from(html??'unavailable')};};
 return {fetcher,calls};
}
const link=id=>`<a href="https://books.rakuten.co.jp/rb/${id}/">ポケモンカード ${id}</a>`;
test('entry links cannot suppress discovery of another product through search',async()=>{
 const {fetcher,calls}=fakeFetcher({
  'https://books.rakuten.co.jp/robots.txt':'User-agent: *\nAllow: /',
  [ENTRY]:link('1'),[SEARCH]:link('2')+link('1'),
  'https://books.rakuten.co.jp/rb/1/':detail('1'),
  'https://books.rakuten.co.jp/rb/2/':detail('2','ポケモンカードゲーム MEGA 新商品')
 });
 const r=await collect(fetcher);
 assert.equal(r.ok,true);assert.ok(calls.includes(SEARCH));
 assert.ok(r.cases.some(c=>c.id==='rakutenbooks:2'));
 assert.equal(calls.filter(u=>u==='https://books.rakuten.co.jp/rb/1/').length,1);
});
test('fixed watch URLs cannot consume all detail slots before discovered products',async()=>{
 const watches=Array.from({length:70},(_,i)=>`https://books.rakuten.co.jp/rb/${i+10}/`);
 const pages={'https://books.rakuten.co.jp/robots.txt':'User-agent: *\nAllow: /',[ENTRY]:link('10'),[SEARCH]:link('999')};
 for(const url of [...watches,'https://books.rakuten.co.jp/rb/999/'])pages[url]=detail();
 const {fetcher,calls}=fakeFetcher(pages);const r=await collect(fetcher,watches);
 assert.equal(r.ok,true);
 const details=calls.filter(u=>/\/rb\//.test(u));
 assert.equal(details[0],'https://books.rakuten.co.jp/rb/999/');
 assert.equal(details.length,MAX_DETAILS);
 assert.equal(r.discoverySummary.skippedByLimit.length,11);
});
test('search access failure is unknown, not a successful old-entry-only discovery',async()=>{
 const {fetcher}=fakeFetcher({'https://books.rakuten.co.jp/robots.txt':'User-agent: *\nAllow: /',[ENTRY]:link('1')});
 const r=await collect(fetcher);assert.equal(r.ok,false);assert.equal(r.cases,null);assert.match(r.error,/全検索経路/);
});

test('older entry schedule does not hide the current product-detail lottery',()=>{
 const old={id:'rakutenbooks:title:old',title:'ポケモンカードゲーム MEGA ハイクラスパック MEGAドリームex【10パック】',entryPeriod:{end:{iso:'2026-01-26T11:59:00+09:00'}}};
 const fresh={id:'rakutenbooks:18343992',title:'ポケモンカードゲーム MEGA ハイクラスパック MEGAドリームex 【10パック】',entryPeriod:{end:{iso:'2026-10-18T23:59:00+09:00'}}};
 assert.deepEqual(mergeOfficialCases([old],[fresh]),[fresh]);
});

test('discover accepts only canonical Rakuten Books product links and keeps stable ids',()=>{
 const h='<a href="/rb/18595282/?l-id=x">ポケモンカード 30th</a><a href="https://books.rakuten.co.jp/rb/18537075/">ポケモンカード アビスアイ</a><a href="https://evil.example/rb/1/">ポケモンカード</a><a href="/rb/9/">一般商品</a>';
 assert.deepEqual(discover(h).map(x=>x.id),['18595282','18537075']);
});
test('extracts exact lottery periods without guessing shipping dates',()=>{
 const c=extractCase(detail(),'https://books.rakuten.co.jp/rb/18595282/', '2026-10-11T00:00:00Z');
 assert.equal(c.id,'rakutenbooks:18595282');
 assert.equal(c.entryPeriod.start.iso,'2026-08-27T10:00:00+09:00');
 assert.equal(c.entryPeriod.end.iso,'2026-08-30T23:59:00+09:00');
 assert.equal(c.purchasePeriod.start.iso,'2026-09-14T10:00:00+09:00');
 assert.equal(c.purchasePeriod.end.iso,'2026-09-18T09:59:00+09:00');
 assert.equal(c.resultAnnouncement.notAfter,true);
 assert.equal(c.resultAnnouncement.start.iso,'2026-09-14T10:00:00+09:00');
 assert.equal(c.shippingPeriod.raw,'2026年09月中旬発送');
 assert.equal(c.shippingPeriod.start,null);
 assert.equal(c.receivingMethod,'DELIVERY');
});
test('ordinary product and incomplete schedule are rejected',()=>{
 assert.throws(()=>extractCase(detail().replace('【抽選商品について】','通常販売').replace('抽選販売スケジュール','販売スケジュール'),'https://books.rakuten.co.jp/rb/18595282/','x'));
 assert.throws(()=>extractCase(detail().replace('2026/08/30(日) 23:59','締切未定'),'https://books.rakuten.co.jp/rb/18595282/','x'));
});
test('One Piece and Fusion World require the same official lottery evidence',()=>{
 for(const [title,genre] of [['ONE PIECEカードゲーム 世界最強の戦士【OP-17】','one-piece-card'],['ドラゴンボールスーパーカードゲーム フュージョンワールド DUAL EVOLUTION [FB09]','dragon-ball-fw']]){
  const html=detail('1',title);
  assert.equal(extractCase(html,'https://books.rakuten.co.jp/rb/1/','x').genre,genre);
  assert.throws(()=>extractCase(html.replace('【抽選商品について】','通常販売').replace('抽選販売スケジュール','販売スケジュール'),'https://books.rakuten.co.jp/rb/1/','x'));
 }
});
function runs(){
 const cases=[extractCase(detail(),'https://books.rakuten.co.jp/rb/18595282/','a')];
 const a={ok:true,mode:'LIVE',pid:1,cases,ledger:[{requestedUrl:'https://books.rakuten.co.jp/rb/18595282/',status:200,sha256:'a'.repeat(64)}],finishedAt:'2026-10-11T00:00:00Z',coverage:'test',discovery:'OFFICIAL_LOTTERY_ENTRY'};
 const b=structuredClone(a);b.pid=2;b.cases[0].fetchedAt='b';return [a,b];
}
test('independent runs must agree',()=>{
 const [a,b]=runs();assert.equal(compare(a,b).ok,true);assert.throws(()=>compare(a,a));const bad=structuredClone(b);bad.cases[0].title='different';assert.throws(()=>compare(a,bad));
});
test('merge preserves all other sources and stable personal ids',()=>{
 const prior={schemaVersion:1,cases:[{id:'otakara:old',sourceId:'otakara'},{id:'pokemoncenter:old',sourceId:'pokemoncenter'}]};
 const [a,b]=runs(),next=merge(prior,a,b);
 assert.deepEqual(next.cases.slice(0,2),prior.cases);
 assert.equal(next.cases[2].id,'rakutenbooks:18595282');
 assert.deepEqual(merge(next,a,b).cases.map(c=>c.id),next.cases.map(c=>c.id));
});
test('delivery filter works and closed lottery stays closed',()=>{
 const c=runs()[0].cases[0],now=Date.parse('2026-10-11T08:00:00+09:00');
 assert.equal(entryState(c,now),'closed');
 assert.equal(matches(c,{phases:[],receiving:['delivery'],store:''},Date.parse(c.entryPeriod.start.iso)+1000),true);
 assert.equal(matches(c,{phases:[],receiving:['delivery'],store:''},now),false);
 assert.equal(matches(c,{phases:['open'],receiving:['delivery'],store:''},now),false);
 assert.equal(matches(c,{phase:'all',receiving:['store'],store:''},now),false);
});

import fs from 'node:fs';
test('public UI names Rakuten Books and preserves raw approximate shipping text',()=>{
 const app=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(app,/rakutenbooks:'楽天ブックス'/);
 assert.match(app,/shippingPeriod\?\.raw\|\|'未確認'/);
 assert.match(app,/resultAnnouncement\?\.notAfter/);
 assert.match(index,/モバイル閲覧版 0\.1\.\d+/);
 assert.match(index,/app\.mjs\?v=\d+/);
});


test('official entry page can directly produce multiple stable delivery cases',()=>{
 const html=`<html><body>
 <p>抽選受付期間：2026年10月10日 10:00 〜 2026年10月18日 23:59</p>
 <p>当選連絡予定日：2026年10月22日頃</p>
 <p>商品発送予定日：当選者へご案内</p>
 <p>楽天会員であること。1商品あたり1回まで。1世帯1名まで。転売目的不可。配送方法を確認。コンビニ店頭受取・郵便局受取は利用不可。</p>
 <p>対象商品 | ポケモンカードゲーム MEGA テストA</p>
 <p>ポケモンカードゲーム MEGA テストB</p>
 </body></html>`;
 const cases=extractEntryCases(html,'2026-10-11T00:00:00Z');
 assert.equal(cases.length,2);
 assert.equal(cases.length,2);
 assert.ok(cases.every(c=>/^rakutenbooks:title:[a-f0-9]{16}$/.test(c.id)));
 assert.equal(cases[0].entryPeriod.end.iso,'2026-10-18T23:59:00+09:00');
 assert.equal(cases[0].resultAnnouncement.start.date,'2026-10-22');
 assert.equal(cases[0].receivingMethod,'DELIVERY');
 assert.equal(cases[0].sourceUrl,'https://books.rakuten.co.jp/event/game/card/entry/');
});



import {searchUrls,selectTargets,rememberWatch,entrySignature} from '../tools/rakutenbooks/collect.mjs';
test('discovery reaches page 2 and named product searches while recording broken routes',async()=>{
 const urls=searchUrls();assert.equal(urls.length,6);assert.equal(new URL(urls[1]).searchParams.get('p'),'2');
 const pages={'https://books.rakuten.co.jp/robots.txt':'User-agent: *\nAllow: /',[ENTRY]:'<p>抽選受付ページ</p>'};
 for(const u of urls)pages[u]='<p>なし</p>';
 pages[urls[1]]=link('18664603');pages[urls[3]]=link('18664602');
 pages['https://books.rakuten.co.jp/rb/18664603/']=detail('1','ポケモンカードゲーム MEGA ハドウシーカー');
 pages['https://books.rakuten.co.jp/rb/18664602/']=detail('2','ポケモンカードゲーム MEGA スペシャルデッキセット');
 delete pages[urls[5]];
 const r=await collect(fakeFetcher(pages).fetcher);
 assert.equal(r.ok,true);assert.equal(r.cases.length,2);
 assert.ok(r.discoverySummary.warnings.includes('ENTRY_NO_PRODUCT_LINKS'));
 assert.ok(r.discoverySummary.warnings.includes('SEARCH_FETCH_FAILED'));
 assert.equal(r.discoverySummary.searches.filter(s=>s.status==='FAILED').length,1);
});
test('large discovery and watch queues both get slots and rotate without silently losing the backlog',()=>{
 const group=(prefix)=>Array.from({length:90},(_,i)=>({id:prefix+i,url:'https://books.rakuten.co.jp/rb/'+i+'/'}));
 const plan=selectTargets(group('d'),group('w'),'2026-11-13');
 assert.equal(plan.selected.length,MAX_DETAILS);assert.equal(plan.deferred.length,180-MAX_DETAILS);
 assert.equal(plan.selected.filter(c=>c.id.startsWith('w')).length,MAX_DETAILS/2);
 assert.deepEqual(plan,selectTargets(group('d'),group('w'),'2026-11-13'));
 assert.notDeepEqual(plan.selected,selectTargets(group('d'),group('w'),'2026-11-14').selected);
});
test('verified and deferred canonical products persist for next runs, excluding affiliate or other hosts',()=>{
 const run={cases:[{sourceUrl:'https://books.rakuten.co.jp/rb/2/'},{sourceUrl:ENTRY}],discoverySummary:{skippedByLimit:[{url:'https://books.rakuten.co.jp/rb/3/'},{url:'https://evil.example/rb/4/'}]}};
 assert.deepEqual(rememberWatch({urls:['https://books.rakuten.co.jp/rb/1/']},run).urls,[1,2,3].map(id=>'https://books.rakuten.co.jp/rb/'+id+'/'));
});
test('reopened periods are distinct from rechecks and retain first publication date',()=>{
 const [a,b]=runs(),prior={schemaVersion:1,cases:[]};
 const first=merge(prior,a,b);assert.equal(first.sources.rakutenbooks.changes.new.length,1);
 const same=merge(first,a,b);assert.equal(same.sources.rakutenbooks.changes.rechecked.length,1);
 for(const r of [a,b]){r.cases[0].entryPeriod.end.iso='2026-11-18T23:59:00+09:00';r.finishedAt='2026-11-13T01:00:00Z';}
 const next=merge(first,a,b);assert.equal(next.sources.rakutenbooks.changes.reopened.length,1);
 assert.equal(next.cases[0].firstPublishedAt,first.cases[0].firstPublishedAt);
 assert.equal(next.cases[0].reopenedAt,b.finishedAt);
 assert.notEqual(entrySignature(first.cases[0]),entrySignature(next.cases[0]));
});
