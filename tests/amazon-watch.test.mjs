import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeeds,buildStormHandoff} from '../tools/amazon-watch/build-seeds.mjs';

test('recent concrete lottery cases become Amazon discovery seeds',()=>{
 const snapshot={cases:[
  {id:'r1',sourceId:'rakutenbooks',title:'ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」',entryPeriod:{end:{iso:'2026-10-10T23:59:00+09:00'}}},
  {id:'r2',sourceId:'rakutenbooks',title:'ポケモンカードゲーム MEGA 拡張パック ムニキスゼロ【30パック】',entryPeriod:{end:{iso:'2026-01-26T11:59:00+09:00'}}},
  {id:'x',sourceId:'otakara',title:'ポケモンカードゲーム 2種 抽選販売に関して',entryPeriod:{end:{iso:'2026-10-11T23:45:00+09:00'}}}
 ]};
 const out=buildSeeds(snapshot,{now:new Date('2026-10-11T12:00:00+09:00')});
 assert.ok(out.seeds.some(x=>x.query.includes('ストームエメラルダ')));
 assert.ok(!out.seeds.some(x=>x.query.includes('ムニキスゼロ')));
 assert.ok(!out.seeds.some(x=>/^2種/.test(x.query)));
 assert.ok(out.seeds.some(x=>x.query==='ポケモンカード 招待販売'));
});
test('CRAWL STORM handoff contains only live ASIN pool items',()=>{
 const out=buildStormHandoff({items:[
  {asin:'B0ABCDEFGHI',state:'new',productKey:'storm'},
  {asin:'B0JKLMNOPQ',state:'retired'}
 ]},{generatedAt:'2026-10-11T00:00:00Z'});
 assert.equal(out.consumer,'CRAWL_STORM_X');
 assert.equal(out.items.length,1);
 assert.equal(out.items[0].url,'https://www.amazon.co.jp/dp/B0ABCDEFGHI');
 assert.equal(out.items[0].priority,90);
});
