import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {discover,scheduleImage,parseTables,collect,compare} from '../tools/pokemoncenter/collect.mjs';

// OCR output from the official 2026-09-29 image downloaded on 2026-10-11 JST.
// Replaying these saved characters is not a fresh website acquisition.
const fixture=JSON.parse(fs.readFileSync(new URL('fixtures/pokemoncenter-20260929-ocr.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(fixture);
test('official image OCR: two products and all schedule endpoints match visual inspection',()=>{
 const c=parseTables(fixture,2026);
 assert.equal(c.length,2);
 assert.equal(c[0].title,'ポケモンカードゲーム MEGA 拡張パック「インフェルノX」');
 assert.equal(c[1].title,'ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」');
 for(const x of c){assert.equal(x.entryPeriod.start.iso,'2026-10-02T12:00:00+09:00');assert.equal(x.entryPeriod.end.iso,'2026-10-05T16:59:00+09:00');assert.equal(x.purchasePeriod.end.iso,'2026-10-20T16:59:00+09:00');}
 assert.equal(c[0].resultAnnouncement.start.iso,'2026-10-14T15:00:00+09:00');
 assert.equal(c[1].resultAnnouncement.start.iso,'2026-10-14T17:00:00+09:00');
 assert.equal(c[0].shippingPeriod.start.date,'2026-12-10');assert.equal(c[0].shippingPeriod.end.date,'2026-12-25');
 assert.equal(c[1].shippingPeriod.start.date,'2026-11-25');assert.equal(c[1].shippingPeriod.end.date,'2026-12-10');
 assert.equal(c[0].shippingPeriod.start.iso,null);assert.equal(c[0].resultAnnouncement.notBefore,true);
 assert.equal(c[0].entryPeriod.start.yearBasis,'ARTICLE_PUBLICATION');
 assert.equal(c[0].entryPeriod.status,'INFERRED');
});
test('wrong publication year fails weekday validation',()=>assert.throws(()=>parseTables(fixture,2027)));
test('missing clock time is never supplemented',()=>{const f=clone();f[0].values[0]=f[0].alternate[0]='10月2日（金）〜10月5日（月）';assert.throws(()=>parseTables(f,2026));});
test('missing first digit fails weekday validation',()=>{const f=clone();f[0].values[1]=f[0].alternate[1]='1月14日（水）15時00分以降';assert.throws(()=>parseTables(f,2026));});
test('OCR date disagreement is rejected',()=>{const f=clone();f[0].alternate[0]=f[0].alternate[0].replace('16時59分','16時58分');assert.throws(()=>parseTables(f,2026));});
test('unfamiliar table labels and product names are rejected',()=>{const f=clone();f[0].labels[0]='当選者購入期間';assert.throws(()=>parseTables(f,2026));f[0].labels[0]='抽選応募受付期間';f[0].title='通常販売';assert.throws(()=>parseTables(f,2026));});
test('discover latest canonical official lottery news, exclude purchase error notices',()=>{
 assert.deepEqual(discover('<a href="/news/?id=20260904&slide=modal">ポケモンカードゲーム抽選販売</a><a href="/news/?id=20260929">ポケモンカードゲームの追加抽選販売</a><a href="/news/?id=20261010">ポケモンカードゲーム抽選販売・購入できないお詫び</a><a href="https://evil.example/news/?id=20261011">ポケモンカードゲーム抽選販売</a>').map(x=>x.url),['https://www.pokemoncenter-online.com/news/?id=20260929']);
});
test('only one official schedule image is accepted',()=>{
 const h='【各種の期間詳細】<img src="/on/demandware.static/date.png">【応募枠の違いについて】';
 assert.equal(scheduleImage(h,'https://www.pokemoncenter-online.com/news/?id=20260929'),'https://www.pokemoncenter-online.com/on/demandware.static/date.png');
 assert.throws(()=>scheduleImage(h.replace('/on/demandware.static/date.png','https://evil.example/date.png'),'https://www.pokemoncenter-online.com/'));
 assert.throws(()=>scheduleImage(h.replace('【応募枠','<img src="/two.png">【応募枠'),'https://www.pokemoncenter-online.com/'));
});
test('HTTP failure stays unknown, not zero cases',async()=>{
 const r=await collect(async url=>({ok:false,error:'HTTP 403',requestedUrl:url,status:403,body:null}),()=>fixture);
 assert.equal(r.ok,false);assert.equal(r.cases,null);assert.equal(r.stage,'FETCH');assert.equal(r.ledger[0].status,403);
});
test('dry-run comparison requires independent successful live processes and equal values',()=>{
 const a={ok:true,mode:'LIVE',pid:1,cases:[{title:'test',fetchedAt:'a'}],ledger:[{requestedUrl:'x',sha256:'1'}]};
 const b={...structuredClone(a),pid:2};b.cases[0].fetchedAt='b';
 assert.equal(compare(a,b).ok,true);assert.throws(()=>compare(a,a));assert.throws(()=>compare({...a,mode:'REPLAY'},b));assert.throws(()=>compare({...a,ok:false},b));
 b.cases[0].title='different';assert.throws(()=>compare(a,b));
});
