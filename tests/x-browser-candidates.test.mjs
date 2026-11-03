import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVisiblePosts,ingestVisiblePosts} from '../tools/x-social-discovery/browser-candidates.mjs';
const make=(url='https://www.amazon.co.jp/dp/B0H4PQ6LR5?tag=advertiser-22')=>normalizeVisiblePosts('pokecasokuhou',[{url:'/pokecasokuhou/status/2114585771139330495',text:'Amazon招待販売受付開始',urls:[url]}]);
test('visible post belongs to requested account, with stable deduplication',()=>{
 assert.equal(make().length,1);
 assert.equal(normalizeVisiblePosts('other',make().map(x=>({url:x.postUrl,text:x.text}))).length,0);
 assert.equal(normalizeVisiblePosts('pokecasokuhou',[{url:'https://evil.test/pokecasokuhou/status/123',text:'x'}]).length,0);
});
test('affiliate link becomes canonical candidate; no acceptance or public snapshot',async()=>{
 const r=await ingestVisiblePosts(make(),{},{items:[]});
 assert.equal(r.candidates.amazon[0].canonicalUrl,'https://www.amazon.co.jp/dp/B0H4PQ6LR5');
 assert.equal(r.pool.items[0].source,'x-browser');assert.equal(r.pool.items[0].state,'new');
 assert.ok(!JSON.stringify(r).includes('advertiser'));
 assert.equal(r.candidates.amazon[0].publishDirectly,false);assert.equal(r.counts.newAsins,1);
});
test('replay and multiple accounts retain evidence without duplicate ASIN or first-source overwrite',async()=>{
 const a=await ingestVisiblePosts(make(),{},{items:[{asin:'B0H4PQ6LR5',source:'manual',firstSeenAt:'old',state:'watching'}]});
 const posts=make().map(x=>({...x,handle:'lifeprep_list',postUrl:'https://x.com/lifeprep_list/status/123'}));
 const b=await ingestVisiblePosts(posts,a.candidates,a.pool),c=await ingestVisiblePosts(posts,b.candidates,b.pool);
 assert.equal(c.candidates.amazon.length,1);assert.equal(c.candidates.amazon[0].evidence.length,2);
 assert.equal(c.pool.items[0].source,'manual');assert.equal(c.pool.items[0].firstSeenAt,'old');assert.equal(c.counts.newAsins,0);
});
test('unresolved short URL stays unconfirmed and affiliate URL is not persisted',async()=>{
 const r=await ingestVisiblePosts(make('https://amzn.to/unknown'),{},{items:[]});
 assert.equal(r.candidates.amazon.length,0);assert.equal(r.candidates.review.length,1);
 assert.ok(!JSON.stringify(r).includes('amzn.to'));assert.equal(r.pool.items.length,0);
});
test('result notice and old pinned posts never turn into REQUESTABLE',async()=>{
 const posts=make();posts[0].text='招待リクエストの結果を通知';posts[0].postedAt='2026-06-01T00:00:00Z';
 const r=await ingestVisiblePosts(posts,{},{items:[]});
 assert.equal(r.candidates.amazon[0].verificationRequired,true);assert.ok(!JSON.stringify(r).includes('REQUESTABLE'));
});
