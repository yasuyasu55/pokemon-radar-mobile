import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyPage,summarizeHealth} from '../tools/amazon-offer-check/page-health.mjs';
import {isAccessBlocked} from '../tools/amazon-browser-probe/browser-probe.mjs';
const healthy={status:200,expectedDestination:true,productTitleNodes:1,spanProductTitleNodes:1,productTitleLength:40};
test('HTTP 200 without product evidence is unknown, never readable or no-invitation',()=>{
  assert.equal(classifyPage({...healthy,productTitleNodes:0,productTitleLength:0}),'UNKNOWN_RESPONSE');
});
test('challenge and HTTP failures take precedence over apparent product text',()=>{
  assert.equal(classifyPage({...healthy,status:503}),'ACCESS_CHALLENGE');
  assert.equal(classifyPage({...healthy,challenge:true}),'ACCESS_CHALLENGE');
  assert.equal(classifyPage({...healthy,status:404}),'HTTP_FAILURE');
});
test('sign-in wall, wrong destination and generic error are not products',()=>{
  assert.equal(classifyPage({...healthy,signIn:true}),'SIGN_IN_WALL');
  assert.equal(classifyPage({...healthy,expectedDestination:false}),'WRONG_DESTINATION');
  assert.equal(classifyPage({...healthy,genericError:true}),'GENERIC_ERROR');
});
test('late loading and tag-specific selector mismatch are reported separately',()=>{
  const s=summarizeHealth([{...healthy,productTitleNodes:0,productTitleLength:0},{...healthy,spanProductTitleNodes:0}]);
  assert.equal(s.outcome,'READABLE_PRODUCT');assert.equal(s.lateProductTitle,true);assert.equal(s.titleSelectorMismatch,true);
});
test('empty evidence remains unknown',()=>{assert.equal(summarizeHealth([]).outcome,'NO_EVIDENCE');});
test('production detects a CAPTCHA form even when HTTP 200 and body text look innocuous',()=>{
  assert.equal(isAccessBlocked({status:200,text:'Amazon',challengeElement:true}),true);
  assert.equal(isAccessBlocked({status:200,text:'ポケモンカード',challengeElement:false}),false);
});
test('diagnostic never clicks, saves cookies/raw body, publishes or circumvents challenges',()=>{
  const source=fs.readFileSync(new URL('../tools/amazon-offer-check/diagnose.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.click\(|storageState\(|page\.content\(|screenshot\(|snapshot\.json/);
  assert.match(source,/stop=true;break/);assert.match(source,/role:'read-only-page-health/);
});
