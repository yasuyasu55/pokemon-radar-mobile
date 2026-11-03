import test from 'node:test';
import assert from 'node:assert/strict';
import {readVisibleAccount} from '../tools/x-social-discovery/read-visible.mjs';
function page({navigationError,postError,expandError}={}){
 const calls=[];
 const more={count:async()=>1,first:()=>({isVisible:async()=>true,click:async()=>{if(expandError)throw Object.assign(new Error(),{name:'TimeoutError'});}})};
 return {calls,goto:async(u,o)=>{calls.push(o);if(navigationError)throw Object.assign(new Error(),{name:'TimeoutError'});},locator:()=>({first:()=>({waitFor:async o=>{calls.push(o);if(postError)throw Object.assign(new Error(),{name:'TimeoutError'});}}),getByRole:()=>more,evaluateAll:async()=>[{url:'/pokecamatomeru/status/123',text:'visible post'}]})};
}
test('document commit and post readiness are separate; first profile gets time for cold start',async()=>{
 const p=page(),r=await readVisibleAccount(p,'pokecamatomeru');
 assert.equal(r.rows.length,1);assert.equal(p.calls[0].waitUntil,'commit');assert.equal(p.calls[1].timeout,90000);
});
test('Show more timeout preserves already readable posts',async()=>{
 const r=await readVisibleAccount(page({expandError:true}),'pokecamatomeru');
 assert.equal(r.rows.length,1);assert.equal(r.expansionIncomplete,true);
});
test('missing posts is explicit unavailability with stage; no retries',async()=>{
 const p=page({postError:true}),r=await readVisibleAccount(p,'pokecamatomeru');
 assert.equal(r.error,'TimeoutError');assert.equal(r.stage,'WAIT_POSTS');assert.equal(r.rows.length,0);assert.equal(p.calls.length,2);
});
test('navigation failure is distinguished from render failure',async()=>{
 const p=page({navigationError:true}),r=await readVisibleAccount(p,'pokecamatomeru');
 assert.equal(r.stage,'NAVIGATE');assert.equal(p.calls.length,1);
});
