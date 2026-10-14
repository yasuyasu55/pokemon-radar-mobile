import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAccount} from '../tools/x-social-discovery/collect-posts.mjs';
const tweet=id=>({id:String(id),text:'招待 https://www.amazon.co.jp/dp/B0GP9QHQ3Y'});
test('page limit persists continuation without skipping older unread posts',async()=>{
  const routes=[];const persisted=[];
  const request=async route=>{
    routes.push(route);
    const token=new URL('https://api.x.com'+route).searchParams.get('pagination_token');
    return token==='next'?{data:[tweet(101)],meta:{}}:{data:[tweet(103),tweet(102)],meta:{next_token:'next'}};
  };
  const a=await collectAccount('test',{userId:'1',sinceId:'100'},request,async ps=>persisted.push(...ps),{maxPages:1});
  assert.equal(a.state.sinceId,'100');assert.equal(a.outcome,'partial');
  const b=await collectAccount('test',a.state,request,async ps=>persisted.push(...ps),{maxPages:1});
  assert.equal(b.state.sinceId,'103');assert.equal(b.state.pending,null);
  assert.deepEqual(persisted.map(p=>p.postId),['103','102','101']);
  assert.match(routes[1],/since_id=100/);assert.match(routes[1],/pagination_token=next/);
});
test('processing failure replays same page and does not advance cursor',async()=>{
  const r=await collectAccount('test',{userId:'1',sinceId:'100'},async()=>({data:[tweet(101)],meta:{}}),async()=>{throw Error('disk');});
  assert.equal(r.state.sinceId,'100');assert.equal(r.outcome,'processing-failed');
});
test('invalid continuation resets only pending state; confirmed bound survives',async()=>{
  const e=Object.assign(Error('invalid'),{status:400});
  const r=await collectAccount('test',{userId:'1',sinceId:'100',pending:{sinceId:'100',token:'old',newestId:'200'}},async()=>{throw e;},async()=>{});
  assert.equal(r.state.sinceId,'100');assert.equal(r.state.pending,null);
});
test('rate limits and malformed successful responses are never zero-post success',async()=>{
  const request=async()=>{throw Object.assign(Error('rate'),{status:429});};
  assert.equal((await collectAccount('test',{userId:'1'},request,async()=>{})).outcome,'rate-limited');
  assert.equal((await collectAccount('test',{userId:'1'},async()=>({errors:[{}]}),async()=>{})).outcome,'invalid-response');
});
