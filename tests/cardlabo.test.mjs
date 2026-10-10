import test from 'node:test';import assert from 'node:assert/strict';
import {discover,extractCase,merge} from '../tools/cardlabo/collect.mjs';
const url='https://www.c-labo.jp/shop/toyohashi/blog/619594/';
// 実本文の構造を模した最小fixture。これを実取得成功とは数えない。
const html='<article><h1>ポケモンカードゲーム 抽選販売</h1><p>応募期間：2026年10月9日(金)～10月11日(日)</p><p>当選発表：2026年10月12日(月)</p><p>当選者の購入可能期間</p><p>2026年10月13日(火)～2026年10月18日(日)</p><p>フォロー＆対象ツイートのリポストで応募</p><p>店頭でのご購入可能な方のみ。代理購入不可。</p></article><footer>締切2026年12月31日23:59</footer>';
const shop='<h1>豊橋店</h1><table><tr><th>所在地</th><td>愛知県豊橋市広小路1-18</td></tr></table>';
const c=()=>extractCase(html,url,shop,'2026-10-10T00:00:00Z');
test('記事本文のみ・応募と購入の分離・締切時刻を補完しない',()=>{const x=c();assert.equal(x.entryPeriod.end.date,'2026-10-11');assert.equal(x.entryPeriod.end.iso,null);assert.equal(x.purchasePeriod.end.date,'2026-10-18');assert.equal(x.stores[0].prefecture,'愛知県');assert.equal(x.receivingMethod,'STORE_ONLY');assert.equal(x.webApplicationUrl,null);});
test('買取・一覧・大会・外部URLは案件化しない',()=>{for(const h of[html.replace('抽選販売','買取'),html.replace('<article>','<main>').replace('</article>','</main>')])assert.throws(()=>extractCase(h,url,shop,''));assert.throws(()=>extractCase(html,'https://evil.test/shop/a/blog/1/',shop,''));const d=discover(`<a href="${url}">ポケモン抽選</a><a href="/shop/a/blog/123/">ポケモン買取</a>`);assert.equal(d.candidates.length,1);assert.equal(d.excluded.length,1);});
test('応募方法・日程・所在地の欠落で採用しない',()=>{for(const h of[html.replace('応募期間','不明期間'),html.replace('リポスト','未確認')])assert.throws(()=>extractCase(h,url,shop,''));assert.throws(()=>extractCase(html,url,'<h1>豊橋店</h1>',''));});
test('年なし日付を確定せず、曜日不一致は原文を保持し警告',()=>{assert.throws(()=>extractCase(html.replace('2026年10月9日','10月9日'),url,shop,''));const x=extractCase(html.replace('9日(金)','9日(月)'),url,shop,'');assert.ok(x.conditions.some(t=>t.includes('不一致')));assert.equal(x.entryPeriod.start.date,'2026-10-09');});
test('独立2回の抽出一致のみ採用し他情報源・既存IDを保持',()=>{const a={ok:true,mode:'LIVE',pid:1,cases:[c()],ledger:[]},b={...a,pid:2};const p={schemaVersion:1,cases:[{id:'otakara:1',sourceName:'お宝創庫'}]};assert.equal(merge(p,a,b).cases.length,2);assert.deepEqual(merge(p,a,b).cases[0],p.cases[0]);for(const bad of[{...b,pid:1},{...b,ok:false},{...b,mode:'REPLAY'},{...b,cases:[{...c(),title:'違い'}]}])assert.throws(()=>merge(p,a,bad));});
