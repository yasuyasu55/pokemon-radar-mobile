import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../tools/amazon-browser-probe/update-live.mjs',import.meta.url));
const loader=new URL('./helpers/amazon-probe-loader.mjs',import.meta.url).href;
test('real CLI subprocess passes targets file to the second independent browser process',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-cli-'));
  try{
    const snapshot=path.join(dir,'snapshot.json'),pool=path.join(dir,'pool.json'),out=path.join(dir,'results');
    fs.writeFileSync(snapshot,JSON.stringify({cases:[],sources:{}}));
    fs.writeFileSync(pool,JSON.stringify({items:[{asin:'B0GP9QHQ3Y',state:'new'},{asin:'B0G1XB2STM',state:'new'},{asin:'B0GXCRBL5J',state:'new'}]}));
    const r=spawnSync(process.execPath,[cli,'all',out,snapshot,pool],{encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:'--experimental-loader='+loader}});
    assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
    const read=n=>JSON.parse(fs.readFileSync(path.join(out,n),'utf8'));
    const a=read('1/result.json'),b=read('2/result.json');
    assert.notEqual(a.pid,b.pid);
    assert.equal(a.fixedTargets,false);assert.equal(b.fixedTargets,true);
    assert.deepEqual(b.searches,[]);
    assert.deepEqual(b.receivedSeeds,a.details.map(d=>d.asin));
    assert.deepEqual(b.details.map(d=>d.asin),a.details.map(d=>d.asin));
    assert.equal(read('status.json').targets.consistent,true);
    assert.equal(JSON.parse(fs.readFileSync(snapshot,'utf8')).cases.length,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
