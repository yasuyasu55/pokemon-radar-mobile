import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function validateAsin(value){
  const asin=String(value||'').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin)?asin:null;
}
export function mergeDiscoveredAsins(pool, discoveries, {now=new Date()}={}){
  const at=now.toISOString();
  const map=new Map((pool.items||[]).map(x=>[x.asin,{...x}]));
  for(const d of discoveries||[]){
    const asin=validateAsin(d.asin);
    if(!asin)continue;
    const current=map.get(asin);
    const query=String(d.query||'').trim();
    const title=String(d.title||'').trim();
    if(current){
      current.lastSeenAt=at;
      current.lastDiscoveryAt=at;
      current.state=current.state==='retired'?'watching':(current.state||'watching');
      current.queries=[...new Set([...(current.queries||[]),...(query?[query]:[])])];
      if(title&&!current.title)current.title=title;
    }else{
      map.set(asin,{
        asin,
        state:'new',
        firstSeenAt:at,
        lastSeenAt:at,
        lastDiscoveryAt:at,
        lastCheckedAt:null,
        title:title||null,
        productKey:d.productKey||null,
        queries:query?[query]:[],
        source:'amazon-search'
      });
    }
  }
  return {schemaVersion:1,updatedAt:at,items:[...map.values()].sort((a,b)=>a.asin.localeCompare(b.asin))};
}
export function stormBatchInput(pool){
  return {
    schemaVersion:1,
    kind:'POKEMON_RADAR_AMAZON_ASIN_BATCH',
    generatedAt:new Date().toISOString(),
    urls:(pool.items||[])
      .filter(x=>x.state!=='retired'&&validateAsin(x.asin))
      .map(x=>({
        sourceId:'amazon',
        asin:x.asin,
        url:'https://www.amazon.co.jp/dp/'+x.asin,
        title:x.title||null,
        priority:x.state==='invitation-active'?100:x.state==='new'?90:x.state==='watching'?70:40
      }))
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action,...args]=process.argv.slice(2);
  if(action==='merge'){
    const [poolPath,discoveriesPath,outPath]=args;
    const pool=JSON.parse(fs.readFileSync(poolPath,'utf8'));
    const discoveries=JSON.parse(fs.readFileSync(discoveriesPath,'utf8'));
    const next=mergeDiscoveredAsins(pool,discoveries.items||discoveries);
    fs.writeFileSync(outPath,JSON.stringify(next,null,2)+'\n');
    console.log(JSON.stringify({items:next.items.length,newItems:next.items.filter(x=>x.state==='new').length}));
  }else if(action==='storm'){
    const [poolPath,outPath]=args;
    const pool=JSON.parse(fs.readFileSync(poolPath,'utf8'));
    const out=stormBatchInput(pool);
    fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');
    console.log(JSON.stringify({urls:out.urls.length}));
  }else throw new Error('Usage: merge|storm');
}
