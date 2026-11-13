import test from 'node:test';
import assert from 'node:assert/strict';
import {NewCaseTracker} from '../new-cases.mjs';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};};
const c=(id,end)=>({id,entryPeriod:{start:{iso:'2026-11-13T10:00:00+09:00'},end:{iso:end}}});
test('period changes reopen a known product, refetches do not, acknowledgement persists',()=>{
 const s=storage(),t=new NewCaseTracker(s),a=c('a','2026-11-18T23:59:00+09:00');
 t.update([a]);assert.equal(t.has('a'),false);
 t.update([{...a,fetchedAt:'new'}]);assert.equal(t.has('a'),false);
 const b=c('a','2026-12-18T23:59:00+09:00');t.update([b]);assert.equal(t.isReopened('a'),true);
 const restored=new NewCaseTracker(s);assert.equal(restored.isReopened('a'),true);
 restored.acknowledge();restored.update([b]);assert.equal(restored.has('a'),false);
 restored.update([b,c('b','2026-12-18T23:59:00+09:00')]);assert.equal(restored.has('b'),true);assert.equal(restored.isReopened('b'),false);
});
test('v1 history migration keeps seen and pending without falsely reopening every product',()=>{
 const s=storage();s.setItem('pokemon-radar-new-cases-v1',JSON.stringify({seen:['a'],pending:['b']}));
 const t=new NewCaseTracker(s);t.update([c('a','2026-11-18')]);assert.equal(t.has('a'),false);assert.equal(t.has('b'),true);
});
