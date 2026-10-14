import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptAmazon,verifiedRows} from '../tools/amazon-browser-probe/update-live.mjs';
const detail={asin:'B0GP9QHQ3Y',url:'https://www.amazon.co.jp/dp/B0GP9QHQ3Y',title:'ポケモンカードゲーム BOX',stage:'PRODUCT_PARSED',status:200,candidate:true,checks:{asinMatched:true,amazonSeller:true,invitationNotice:true,requestButton:true}};
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
