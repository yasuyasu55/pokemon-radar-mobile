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

import {merge} from '../tools/pokemoncenter/collect.mjs';
import {entryState,matches} from '../model.mjs';
function adoptionRuns(){
 const cases=parseTables(fixture,2026).map((c,i)=>({...c,id:'pokemoncenter:20260929:'+i,sourceId:'pokemoncenter',sourceUrl:'https://www.pokemoncenter-online.com/news/?id=20260929',receivingMethod:'DELIVERY',stores:[],conditions:['公式の応募枠の条件'],fetchedAt:'2026-10-11T00:00:00Z'}));
 const a={ok:true,mode:'LIVE',pid:1,cases,ledger:Array.from({length:4},()=>({status:200,sha256:'a'.repeat(64),requestedUrl:'https://www.pokemoncenter-online.com/'})),finishedAt:'2026-10-11T00:00:00Z'};return [a,{...structuredClone(a),pid:2}];
}
test('adoption preserves other sources and stable personal-record identifiers',()=>{
 const prior={schemaVersion:1,cases:[{id:'otakara:old',sourceId:'otakara',title:'既存'}, {id:'cardlabo:old',sourceId:'cardlabo',title:'既存'}]};
 const [a,b]=adoptionRuns(),next=merge(prior,a,b);
 assert.deepEqual(next.cases.slice(0,2),prior.cases);assert.equal(next.cases.length,4);
 assert.deepEqual(merge(next,a,b).cases.map(c=>c.id),next.cases.map(c=>c.id));
 assert.equal(next.sources.pokemoncenter.verifiedCases,2);
});
test('failure, replay, incomplete and duplicate candidates cannot replace previous data',()=>{
 const prior={schemaVersion:1,cases:[{id:'old'}]},original=JSON.stringify(prior);const [a,b]=adoptionRuns();
 assert.throws(()=>merge(prior,{...a,ok:false},b));assert.throws(()=>merge(prior,{...a,mode:'REPLAY'},b));
 const incomplete=structuredClone(b);incomplete.cases[0].shippingPeriod.end=null;assert.throws(()=>merge(prior,{...incomplete,pid:1},incomplete));
 const duplicate=structuredClone(b);duplicate.cases.push(duplicate.cases[0]);assert.throws(()=>merge(prior,{...duplicate,pid:1},duplicate));
 assert.equal(JSON.stringify(prior),original);
});
test('delivery filter matches while open, and closed lotteries stay excluded',()=>{
 for(const c of adoptionRuns()[0].cases){
  const openNow=Date.parse('2026-10-03T12:00:00+09:00');
  const closedNow=Date.parse('2026-10-11T08:00:00+09:00');
  assert.equal(entryState(c,openNow),'open');
  assert.equal(matches(c,{phases:[],receiving:['delivery'],store:''},openNow),true);
  assert.equal(matches(c,{phases:[],receiving:['store'],store:''},openNow),false);
  assert.equal(entryState(c,closedNow),'closed');
  assert.equal(matches(c,{phases:[],receiving:['delivery'],store:''},closedNow),false);
 }
});
