import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assessEmptyList,updateSnapshot} from '../tools/mobile/update-snapshot.mjs';
const official='https://www.otakarasouko.com/new_information/';
const result=pid=>({env:{mode:'LIVE',pid},verdict:'NO_CANDIDATE_IN_LIST',extractionVerdict:{level:'NOT_EVALUATED'},
  source:{sourceId:'otakarasouko-group',listUrl:official},candidates:[],counts:{candidates:0},failures:[],finishedAt:'2026-10-15T00:33:00Z',
  ledger:[{stage:'list',ok:true,status:200,requestedUrl:official,normalizedTextSha256:'abc'}],
  list:{url:official,itemsParsed:1,targets:[],skippedByDetailCap:[],detailPathAllowedByRobots:true,
    excluded:[{url:'https://www.otakarasouko.com/information/104021088/',title:'プラモデル抽選',reason:'抽選だがポケモン以外の題名'}]}});
const comparison={overall:'CONSISTENT'};
test('independent successful list-only empty scans retain exact public bytes and timestamps',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'otakara-empty-'));
  try{
    for(const n of [1,2]){fs.mkdirSync(path.join(dir,'run-'+n));fs.writeFileSync(path.join(dir,'run-'+n,'result.json'),JSON.stringify(result(n)));}
    fs.writeFileSync(path.join(dir,'compare.json'),JSON.stringify(comparison));
    const target=path.join(dir,'snapshot.json');
    const original=JSON.stringify({schemaVersion:1,fetchedAt:'old',cases:[{id:'amazon:example',fetchedAt:'old'},{id:'otakarasouko:old',fetchedAt:'old'}]},null,2);
    fs.writeFileSync(target,original);
    const next=updateSnapshot(dir,target);
    assert.equal(next.updateOutcome.status,'NO_CANDIDATE_IN_SCANNED_LIST');assert.equal(next.updateOutcome.changed,false);
    assert.equal(fs.readFileSync(target,'utf8'),original);assert.equal(fs.existsSync(target+'.tmp'),false);
    assert.equal(next.cases.length,2);assert.equal(next.fetchedAt,'old');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const [label,mutate] of Object.entries({
  'replayed response':r=>r.env.mode='REPLAY',
  'missing pid':r=>delete r.env.pid,
  'HTTP failure':r=>r.ledger[0].status=503,
  'unparsed list':r=>r.list.itemsParsed=0,
  'unexplained excluded row':r=>r.list.excluded[0].reason='',
  'wrong source':r=>r.source.sourceId='other',
  'unvisited detail':r=>r.list.skippedByDetailCap.push({url:'unvisited'}),
  'fetch failure':r=>r.failures.push({stage:'list'}),
  'nonempty candidate':r=>r.candidates.push({id:'candidate'}),
  'missing body evidence':r=>delete r.ledger[0].normalizedTextSha256,
  'disagreement':r=>r.list.excluded[0].title='別記事'
})) test(label+' cannot become a successful empty-list result',()=>{
  const b=result(2);mutate(b);assert.throws(()=>assessEmptyList(result(1),b,comparison));
});
test('same process and inconsistent comparison do not suppress a failure',()=>{
  assert.throws(()=>assessEmptyList(result(1),result(1),comparison));
  assert.throws(()=>assessEmptyList(result(1),result(2),{overall:'DIFFERENCES'}));
});
