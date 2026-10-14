import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptAmazon,verifiedRows,saveDiscoveryPool,orderTargets,targetConsistency,markUnconfirmed} from '../tools/amazon-browser-probe/update-live.mjs';
const detail={asin:'B0GP9QHQ3Y',url:'https://www.amazon.co.jp/dp/B0GP9QHQ3Y',title:'ポケモンカードゲーム BOX',stage:'PRODUCT_PARSED',status:200,candidate:true,checks:{asinMatched:true,amazonSeller:true,invitationNotice:true,requestButton:true,invitationPanelVisible:true}};
const run={mode:'BROWSER_POC',pid:1,finishedAt:'2026-10-14T00:00:00Z',details:[detail]};
test('only matching strict detail checks become published rows',()=>{
  const previous={cases:[{id:'rakutenbooks:1'}],sources:{}};
  const next=adoptAmazon(previous,run,{...structuredClone(run),pid:2});
  assert.equal(next.cases.length,2);assert.equal(next.cases[1].invitationState,'REQUESTABLE');
  assert.equal(next.cases[1].receivingMethod,'DELIVERY');
  for(const key of Object.keys(detail.checks)) {
    const bad=structuredClone(run);bad.pid=2;bad.details[0].checks[key]=false;
    assert.equal(adoptAmazon(previous,run,bad),previous);
  }
});
test('blocked, mismatched titles, and missing browser evidence never publish or erase',()=>{
  const bad=structuredClone(run);bad.pid=2;bad.details[0].title='別商品';assert.equal(verifiedRows(run,bad).length,0);
  bad.details[0].title=detail.title;bad.details[0].stage='BLOCKED';assert.equal(verifiedRows(run,bad).length,0);
});
test('new search ASINs survive a run without two-pass confirmation',()=>{
  const next=saveDiscoveryPool({items:[]},{...run,discovered:[{asin:detail.asin,title:detail.title,queries:['search']}]});
  assert.equal(next.items.length,1);assert.equal(next.items[0].state,'new');
  assert.equal(next.items[0].detailCandidate,true);
  assert.equal(saveDiscoveryPool(next,{...run,discovered:[]}).items.length,1);
});
const mk=(pid,rows)=>({...structuredClone(run),pid,details:rows});
test('unconfirmed candidates go first in the next run and the order ignores check time churn',()=>{
  const items=[{asin:'A000000001',lastCheckedAt:'2026-01-01'},{asin:'A000000002',lastCheckedAt:'2026-03-01',unconfirmed:{since:'x'}},{asin:'A000000003',detailCandidate:true,lastCheckedAt:'2026-02-01'},{asin:'A000000004',state:'retired'}];
  assert.deepEqual(orderTargets(items,['A000000001','P000000001']),['A000000002','A000000003','A000000001','P000000001']);
});
test('both runs must inspect the same ASIN set; differences are reported',()=>{
  const a=mk(1,[{asin:'A1'},{asin:'A2'}]),b=mk(2,[{asin:'A2'},{asin:'A3'}]);
  const c=targetConsistency(a,b);
  assert.equal(c.consistent,false);assert.deepEqual(c.onlyRun1,['A1']);assert.deepEqual(c.onlyRun2,['A3']);
  assert.equal(targetConsistency(a,mk(2,[{asin:'A2'},{asin:'A1'}])).consistent,true);
});
test('a candidate seen by only one run is carried over, and cleared once confirmed',()=>{
  const pool={items:[{asin:detail.asin},{asin:'Z000000009'}]};
  const bNo={...detail,candidate:false,stage:'BLOCKED'};
  const a=mk(1,[detail]),b=mk(2,[bNo]);
  const p1=markUnconfirmed(pool,a,b,'T1');
  assert.equal(p1.items[0].unconfirmed.count,1);assert.equal(p1.items[1].unconfirmed,undefined);
  const p2=markUnconfirmed(p1,a,b,'T2');
  assert.equal(p2.items[0].unconfirmed.since,'T1');assert.equal(p2.items[0].unconfirmed.count,2);
  const ok=markUnconfirmed(p2,a,mk(2,[detail]),'T3');
  assert.equal(ok.items[0].unconfirmed,undefined);
  const rejected=markUnconfirmed(p2,mk(1,[{...detail,candidate:false}]),mk(2,[{...detail,candidate:false}]),'T3');
  assert.equal(rejected.items[0].unconfirmed,undefined);
});
test('blocked, missing and failed details preserve prior unconfirmed evidence',()=>{
  const pool={items:[{asin:detail.asin,unconfirmed:{since:'T0',count:1}}]};
  const blocked={asin:detail.asin,stage:'BLOCKED',status:503,candidate:false};
  for(const [x,y] of [[blocked,blocked],[{...detail,candidate:false},blocked],[blocked,undefined],[undefined,undefined]]){
    const result=markUnconfirmed(pool,mk(1,x?[x]:[]),mk(2,y?[y]:[]),'T1');
    assert.equal(result.items[0].unconfirmed.since,'T0');
  }
});
