import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeeds,buildStormHandoff} from '../tools/amazon-watch/build-seeds.mjs';
import {mergeDiscoveredAsins,stormBatchInput} from '../tools/amazon-watch/asin-pool.mjs';

test('recent concrete lottery cases become Amazon discovery seeds',()=>{
 const snapshot={cases:[
  {id:'r1',sourceId:'rakutenbooks',title:'ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」',entryPeriod:{end:{iso:'2026-10-10T23:59:00+09:00'}}},
  {id:'r2',sourceId:'rakutenbooks',title:'ポケモンカードゲーム MEGA 拡張パック ムニキスゼロ【30パック】',entryPeriod:{end:{iso:'2026-01-26T11:59:00+09:00'}}},
  {id:'x',sourceId:'otakara',title:'ポケモンカードゲーム 2種 抽選販売に関して',entryPeriod:{end:{iso:'2026-10-11T23:45:00+09:00'}}}
 ]};
 const out=buildSeeds(snapshot,{now:new Date('2026-10-11T12:00:00+09:00')});
 assert.ok(out.seeds.some(x=>x.query.includes('ストームエメラルダ')));
 assert.ok(!out.seeds.some(x=>x.kind==='case-derived'&&x.query.includes('ムニキスゼロ')));
 assert.ok(out.seeds.some(x=>x.kind==='official-priority-product'&&x.query.includes('ムニキスゼロ')));
 assert.ok(!out.seeds.some(x=>/^2種/.test(x.query)));
 assert.ok(out.seeds.some(x=>x.query==='ポケモンカード 招待販売'));
 assert.ok(out.seeds.some(x=>x.query==='ポケモンカードゲーム MEGAドリームex BOX 招待'));
 assert.ok(out.seeds.some(x=>x.kind==='official-priority-product'));
 assert.ok(!out.seeds.some(x=>x.query==='ストームエメラルダ 抽選'));
});
test('CRAWL STORM handoff contains only live ASIN pool items',()=>{
 const out=buildStormHandoff({items:[
  {asin:'B0ABCDEFGH',state:'new',productKey:'storm'},
  {asin:'B0JKLMNOPQ',state:'retired'}
 ]},{generatedAt:'2026-10-11T00:00:00Z'});
 assert.equal(out.consumer,'CRAWL_STORM_X');
 assert.equal(out.items.length,1);
 assert.equal(out.items[0].url,'https://www.amazon.co.jp/dp/B0ABCDEFGH');
 assert.equal(out.items[0].priority,90);
});


test('discovered ASINs are deduplicated and kept for fixed monitoring',()=>{
 const pool={schemaVersion:1,items:[{asin:'B0ABCDEFGH',state:'watching',queries:['old'],firstSeenAt:'x'}]};
 const out=mergeDiscoveredAsins(pool,[
  {asin:'B0ABCDEFGH',query:'MEGA 招待',title:'商品A'},
  {asin:'B0ZZZZZZZZ',query:'MEGA 抽選',title:'商品B'},
  {asin:'bad',query:'x'}
 ],{now:new Date('2026-10-11T00:00:00Z')});
 assert.equal(out.items.length,2);
 const a=out.items.find(x=>x.asin==='B0ABCDEFGH');
 assert.deepEqual(a.queries.sort(),['MEGA 招待','old'].sort());
 assert.equal(a.state,'watching');
 const b=out.items.find(x=>x.asin==='B0ZZZZZZZZ');
 assert.equal(b.state,'new');
});
test('ASIN pool converts to CRAWL STORM batch URLs without retired items',()=>{
 const out=stormBatchInput({items:[
  {asin:'B0ABCDEFGH',state:'new',title:'A'},
  {asin:'B0ZZZZZZZZ',state:'invitation-active',title:'B'},
  {asin:'B0XXXXXXXX',state:'retired',title:'C'}
 ]});
 assert.equal(out.kind,'POKEMON_RADAR_AMAZON_ASIN_BATCH');
 assert.equal(out.urls.length,2);
 assert.equal(out.urls[0].sourceId,'amazon');
 assert.ok(out.urls.every(x=>x.url.startsWith('https://www.amazon.co.jp/dp/')));
});
