import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {extractAmazon, TARGETS, EXTRACTOR_VERSION} from './extract.mjs';
import {SEARCH_QUERIES,discoverAmazonAsins,mergeDiscovered,searchUrl} from './discover.mjs';
const here=fileURLToPath(import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
export function summarizeObservations(observations) {
  const ok=observations.length===TARGETS.length&&TARGETS.every(asin=>observations.some(o=>o.asin===asin&&o.stage==='PRODUCT_PARSED'));
  return {acquisitionVerdict:ok?'OK':'FAILED',candidateCount:ok?observations.filter(o=>o.extraction?.candidate).length:null};
}

async function fetchPage(requestedUrl) {
  let url=requestedUrl;
  const startedAt=new Date().toISOString();
  try {
    for(let i=0;i<4;i++) {
      const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5','Cache-Control':'no-cache','Pragma':'no-cache','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'}});
      if([301,302,303,307,308].includes(r.status)) {
        const next=new URL(r.headers.get('location'),url);
        if(next.protocol!=='https:'||next.hostname!=='www.amazon.co.jp'||next.username||next.password)throw new Error('Redirect outside allowed host');
        await r.body?.cancel();url=next.href;continue;
      }
      const chunks=[];let size=0;
      for await(const chunk of r.body??[]) {size+=chunk.length;if(size>2*1024*1024)throw new Error('Body exceeds limit');chunks.push(chunk);}
      const buf=Buffer.concat(chunks),html=buf.toString('utf8');
      return {ok:r.status===200,requestedUrl,finalUrl:url,startedAt,finishedAt:new Date().toISOString(),status:r.status,bytes:buf.length,sha256:sha(buf),contentType:r.headers.get('content-type'),html};
    }
    throw new Error('Too many redirects');
  } catch(e) {return {ok:false,requestedUrl,startedAt,finishedAt:new Date().toISOString(),error:e.message,html:null};}
}

async function discover(){
  const searches=[];
  for(const query of SEARCH_QUERIES){
    const r=await fetchPage(searchUrl(query));
    searches.push({query,status:r.status,stage:r.ok?'SEARCH_PARSED':'FETCH_FAILED',bytes:r.bytes,sha256:r.sha256,items:r.ok?discoverAmazonAsins(r.html):[],error:r.error});
  }
  return {searches,candidates:mergeDiscovered(searches)};
}

async function acquire(asin) {
  const requestedUrl=`https://www.amazon.co.jp/gp/product/${asin}`;
  const r=await fetchPage(requestedUrl);
  const transport={asin,requestedUrl,finalUrl:r.finalUrl,startedAt:r.startedAt,finishedAt:r.finishedAt,status:r.status,bytes:r.bytes,sha256:r.sha256,contentType:r.contentType};
  if(!r.ok)return {...transport,stage:'FETCH_FAILED',extraction:null,error:r.error};
  const extraction=extractAmazon(r.html,asin);
  return {...transport,stage:extraction.title?'PRODUCT_PARSED':'UNEXPECTED_RESPONSE',extraction};
}

async function run(out) {
  const result={schemaVersion:2,mode:'LIVE',environment:process.env.GITHUB_ACTIONS?'GitHub Actions':'Development environment',extractorVersion:EXTRACTOR_VERSION,pid:process.pid,startedAt:new Date().toISOString(),searches:[],discovered:[],observations:[]};
  const d=await discover();result.searches=d.searches;result.discovered=d.candidates;
  const asins=[...new Set([...d.candidates.map(x=>x.asin),...TARGETS])].slice(0,20);
  for(const asin of asins)result.observations.push(await acquire(asin));
  result.finishedAt=new Date().toISOString();
  const parsed=result.observations.filter(o=>o.stage==='PRODUCT_PARSED');
  result.acquisitionVerdict=result.searches.every(s=>s.stage==='SEARCH_PARSED')&&parsed.length?'OK':'FAILED';
  result.candidateCount=result.acquisitionVerdict==='OK'?parsed.filter(o=>o.extraction?.candidate).length:null;
  result.adoption='NOT_ENABLED';
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({acquisition:result.acquisitionVerdict,discovered:result.discovered.map(x=>x.asin),candidateCount:result.candidateCount,searches:result.searches.map(s=>({query:s.query,status:s.status,stage:s.stage,count:s.items.length})),observations:result.observations.map(o=>({asin:o.asin,status:o.status,stage:o.stage,title:o.extraction?.title,kind:o.extraction?.kind,reason:o.extraction?.reason}))}));
  return result.acquisitionVerdict==='OK'?0:10;
}

function comparable(o) {return o.extraction;}
export function compareRuns(a,b) {
  if(a.mode!=='LIVE'||b.mode!=='LIVE'||a.extractorVersion!==b.extractorVersion||a.pid===b.pid||a.acquisitionVerdict!=='OK'||b.acquisitionVerdict!=='OK')return {overall:'NOT_VERIFIED',adoption:'NOT_ENABLED',rows:[]};
  const asins=[...new Set([...a.observations.map(x=>x.asin),...b.observations.map(x=>x.asin)])].sort();
  const rows=asins.map(asin=>{
    const x=a.observations.find(o=>o.asin===asin),y=b.observations.find(o=>o.asin===asin);
    return {asin,bodySame:!!x&&!!y&&x.sha256===y.sha256,extractionSame:!!x&&!!y&&JSON.stringify(comparable(x))===JSON.stringify(comparable(y)),kind:y?.extraction?.kind??'UNKNOWN'};
  });
  const discoverySame=JSON.stringify(a.discovered?.map(x=>x.asin).sort()??[])===JSON.stringify(b.discovered?.map(x=>x.asin).sort()??[]);
  return {overall:discoverySame&&rows.every(r=>r.extractionSame)?'CONSISTENT':'DIFFERENT',adoption:'NOT_ENABLED',discoverySame,rows};
}
async function all(out) {
  const codes=[];
  for(const n of [1,2]) {
    const child=spawnSync(process.execPath,[here,'run',path.join(out,`run-${n}`)],{stdio:'inherit',timeout:120000});codes.push(child.status??99);
    if(n===1)await new Promise(resolve=>setTimeout(resolve,20000));
  }
  const read=n=>JSON.parse(fs.readFileSync(path.join(out,`run-${n}`,'result.json'),'utf8'));
  const a=read(1),b=read(2),comparison=compareRuns(a,b);
  fs.writeFileSync(path.join(out,'compare.json'),JSON.stringify(comparison,null,2)+'\n');
  fs.writeFileSync(path.join(out,'SUMMARY.md'),`# Amazon実取得検証\n\n取得工程: ${a.acquisitionVerdict} / ${b.acquisitionVerdict}\n\n2回の抽出比較: ${comparison.overall}\n\n候補数: ${b.candidateCount??'判定不能'}\n\n公開・本番採用・定期更新: 無効\n\n${b.observations.map(o=>`- ${o.asin}: HTTP ${o.status??'未取得'} / ${o.extraction?.kind??'取得失敗'} / ${o.extraction?.reason??o.error??o.stage}`).join('\n')}\n\n締切・当選日・受取条件・本人の応募済み状態は補完しません。構造上の操作の存在を確認するだけで、実ブラウザでの操作可否・ログイン後の表示は未確認です。応答はこの環境で受け取ったバイト列のハッシュです。キャッシュの有無や新しいソケット接続は証明しません。生HTML・Cookie・応答ヘッダーは保存しません。\n`);
  console.log(JSON.stringify(comparison));
  return codes.some(c=>c!==0)?10:comparison.overall==='CONSISTENT'?0:30;
}
if(process.argv[1]&&path.resolve(process.argv[1])===here) {
  const [command,out]=process.argv.slice(2);
  if(!out||!['run','all'].includes(command))throw new Error('Usage: node cli.mjs run|all output-directory');
  try{process.exitCode=command==='run'?await run(out):await all(out);}catch(e){console.error(e.message);process.exitCode=99;}
}
