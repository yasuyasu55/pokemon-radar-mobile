import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {reserveDay,publicHasCases} from '../tools/pc-collector/checks.mjs';
test('JST calendar day, not rolling 24 hours, controls PC attempts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-day-'));
 try{
  assert.equal(reserveDay(dir,new Date('2026-11-02T14:59:59Z')),true);
  assert.equal(reserveDay(dir,new Date('2026-11-02T14:59:59Z')),false);
  assert.equal(reserveDay(dir,new Date('2026-11-02T15:00:00Z')),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('two PC processes cannot reserve the same day twice',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-race-'));
 const module=new URL('../tools/pc-collector/checks.mjs',import.meta.url).href;
 const one=()=>new Promise((resolve,reject)=>{
  const code=`import {reserveDay} from ${JSON.stringify(module)};console.log(reserveDay(${JSON.stringify(dir)},new Date('2026-11-02T00:00:00Z')));`;
  const p=spawn(process.execPath,['--input-type=module','-e',code]);let out='';p.stdout.on('data',d=>out+=d);p.on('error',reject);p.on('close',s=>s===0?resolve(out.trim()):reject(new Error('child failed')));
 });
 try{assert.deepEqual((await Promise.all([one(),one()])).sort(),['false','true']);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('old public row or missing expected row never confirms publication',()=>{
 const fresh={id:'amazon:X',title:'test',sourceUrl:'https://www.amazon.co.jp/dp/B0GP9QHQ3Y',fetchedAt:'2026-11-02T01:00:00Z'};
 const s={schemaVersion:1,cases:[fresh]};
 assert.equal(publicHasCases(s,[fresh]),true);
 assert.equal(publicHasCases({...s,cases:[{...fresh,fetchedAt:'old'}]},[fresh]),false);
 assert.equal(publicHasCases({...s,cases:[]},[fresh]),false);
 assert.equal(publicHasCases(s,[]),false);
});
