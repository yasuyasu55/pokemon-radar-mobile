import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAccount,summarizeAcquisition,run} from '../tools/x-social-discovery/collect-posts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
test('missing X token is reported as NOT_RUNNING, never partial or ok',()=>{
  const s=summarizeAcquisition({tokenSet:false,accounts:[{outcome:'fetch-failed'},{outcome:'public-sample'}]});
  assert.equal(s.status,'NOT_RUNNING_AUTH_UNSET');assert.equal(s.auth,'UNSET');assert.equal(s.collection,'NOT_RUNNING');
  assert.equal(s.publicFallback.usable,1);assert.equal(s.publicFallback.failed,1);
  assert.equal(summarizeAcquisition({tokenSet:false,accounts:[]}).status,'NOT_RUNNING_AUTH_UNSET');
});
test('with a token only a full API success is OK',()=>{
  const h=['a','b'];
  assert.equal(summarizeAcquisition({tokenSet:true,handles:h,accounts:[{outcome:'ok'},{outcome:'ok-zero-posts'}]}).status,'OK');
  assert.equal(summarizeAcquisition({tokenSet:true,handles:h,accounts:[{outcome:'ok'},{outcome:'rate-limited'}]}).status,'PARTIAL_OR_FAILED');
  assert.equal(summarizeAcquisition({tokenSet:true,handles:h,accounts:[{outcome:'ok'}]}).status,'PARTIAL_OR_FAILED');
});
test('unset authentication records NOT_RUNNING without any network request',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-x-unset-'));
  const saved=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('Network must not be used without authentication');};
  try{
    assert.equal(await run(dir,{token:''}),11);
    const report=JSON.parse(fs.readFileSync(path.join(dir,'x-collection-status.json'),'utf8'));
    assert.equal(report.status,'NOT_RUNNING_AUTH_UNSET');
    assert.equal(report.method,'none');assert.deepEqual(report.accounts,[]);
  }finally{globalThis.fetch=saved;fs.rmSync(dir,{recursive:true,force:true});}
});
