import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {run} from './browser-probe.mjs';
import {mergeDiscoveredAsins} from '../amazon-watch/asin-pool.mjs';
export function saveDiscoveryPool(previous,result) {
  const next=mergeDiscoveredAsins(previous,(result.discovered || []).map(d=>({asin:d.asin,title:d.title,query:(d.queries || []).join(' / ')})));
  for(const item of next.items) {
    const detail=result.details.find(d=>d.asin===item.asin);
    if(detail?.stage==='PRODUCT_PARSED') {
      item.lastCheckedAt=result.finishedAt;
      item.detailCandidate=detail.candidate===true;
    }
  }
  return next;
}
// Target order: still-unconfirmed candidates first, then earlier candidates, then least recently checked; published ASINs last.
export function orderTargets(items,published=[]) {
  const rank=x=>x.unconfirmed?0:x.detailCandidate===true?1:2;
  const list=items.filter(x=>x.state!=='retired').sort((a,b)=>rank(a)-rank(b) || String(a.lastCheckedAt || '').localeCompare(String(b.lastCheckedAt || ''))).map(x=>x.asin);
  return [...new Set([...list,...published])];
}
// Both independent runs must have inspected the same ASIN set.
export function targetConsistency(a,b) {
  const sa=new Set(a.details.map(d=>d.asin)),sb=new Set(b.details.map(d=>d.asin));
  const onlyRun1=[...sa].filter(x=>!sb.has(x)),onlyRun2=[...sb].filter(x=>!sa.has(x));
  return {run1:sa.size,run2:sb.size,onlyRun1,onlyRun2,consistent:!onlyRun1.length && !onlyRun2.length};
}
// A candidate seen by at least one run but not confirmed by both stays at the front of the next run; cleared once confirmed or both runs reject it.
export function markUnconfirmed(pool,a,b,at) {
  const verified=new Set(verifiedRows(a,b).map(r=>r.asin));
  const items=pool.items.map(item=>{
    const x=a.details.find(d=>d.asin===item.asin),y=b.details.find(d=>d.asin===item.asin);
    if(!x && !y) return item;
    const seenCandidate=x?.candidate===true || y?.candidate===true;
    const rejected=r=>r?.stage==='PRODUCT_PARSED' && r.status===200 && r.candidate===false;
    if(verified.has(item.asin) || (rejected(x) && rejected(y))) {const {unconfirmed,...rest}=item;return rest;}
    if(!seenCandidate && !item.unconfirmed) return item;
    const reason=x?.candidate===true && y?.candidate===true?'タイトル不一致等で2回の結果が一致しない':y===undefined?'2回目で確認対象に入らなかった':y.candidate===true?'1回目では候補にならなかった':'2回目で候補にならなかった（'+(y.stage||'不明')+'）';
    return {...item,unconfirmed:{since:item.unconfirmed?.since||at,lastReason:reason,lastAt:at,count:(item.unconfirmed?.count||0)+1}};
  });
  return {...pool,items};
}
export function verifiedRows(a,b) {
  if(a.mode!=='BROWSER_POC' || b.mode!=='BROWSER_POC' || !a.pid || !b.pid || a.pid===b.pid) throw new Error('Independent live browser results required');
  return b.details.filter(y=>{
    const x=a.details.find(o=>o.asin===y.asin);
    return x?.candidate===true && y.candidate===true && x.title===y.title &&
      [x,y].every(r=>r.stage==='PRODUCT_PARSED' && r.status===200 && /^[A-Z0-9]{10}$/.test(r.asin) &&
        r.url===`https://www.amazon.co.jp/dp/${r.asin}` && /ポケモンカード/.test(r.title) &&
        ['asinMatched','amazonSeller','invitationNotice','requestButton','invitationPanelVisible'].every(k=>r.checks?.[k]===true));
  });
}
export function adoptAmazon(previous,a,b) {
  const verified=verifiedRows(a,b);
  if(!verified.length) return previous; // never erase old rows on blocked/unknown
  const fresh=verified.map(r=>({id:`amazon:${r.asin}`,sourceId:'official-amazon-jp',sourceName:'Amazon',title:r.title,
    sourceUrl:r.url,fetchedAt:b.finishedAt,publishedDate:null,browserCapture:true,automatedDiscovery:true,
    lotteryType:'INVITATION_SALE',invitationState:'REQUESTABLE',applicationMethod:'Amazonの招待をリクエスト',
    entryPeriod:null,resultAnnouncement:null,purchasePeriod:null,receivingMethod:'DELIVERY',receivingLabel:'配送',
    stores:[],conditions:['Amazon商品詳細の招待リクエスト操作を独立した2回のサーバーブラウザで確認'],
    handoverRestrictions:[],prices:[],unknowns:['応募締切','当選通知時期','購入期限','本人の応募資格・リクエスト状況'],
    verification:'GitHub Actions Chromiumで商品詳細を独立2回確認',asin:r.asin}));
  const map=new Map(previous.cases.map(c=>[c.id,c]));
  for(const row of fresh) map.set(row.id,{...map.get(row.id),...row});
  return {...previous,cases:[...map.values()],sources:{...previous.sources,amazon:{...previous.sources?.amazon,
    name:'Amazon.co.jp',fetchedAt:b.finishedAt,verifiedCases:fresh.length,
    coverage:'既存watchとX候補ASINを商品詳細で独立2回確認。一致したREQUESTABLEのみ更新',
    verification:'GitHub Actions Chromiumの商品詳細確認',lastRunNewAsins:fresh.filter(c=>!previous.cases.some(p=>p.id===c.id)).length}}};
}
const here=fileURLToPath(import.meta.url);
if(process.argv[1] && path.resolve(process.argv[1])===here) {
  const [action,out,snapshot='data/snapshot.json',pool='data/internal/amazon-asin-pool.json']=process.argv.slice(2);
  const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
  if(action==='one') {
    const fixedFile=process.argv[6];
    const prior=read(snapshot),items=fs.existsSync(pool)?read(pool).items:[];
    const published=prior.cases.filter(c=>c.id.startsWith('amazon:')).map(c=>c.asin || c.id.split(':')[1]);
    const fixed=fixedFile?read(fixedFile).targets:null;
    await run(out,fixed || orderTargets(items,published),{fixedTargets:fixed});
    const result=read(path.join(out,'result.json'));
    const nextPool=saveDiscoveryPool(fs.existsSync(pool)?read(pool):{items:[]},result);
    fs.mkdirSync(path.dirname(pool),{recursive:true});
    fs.writeFileSync(pool+'.tmp',JSON.stringify(nextPool,null,2)+'\n');fs.renameSync(pool+'.tmp',pool);
  } else if(action==='all') {
    fs.mkdirSync(out,{recursive:true});
    const runOne=(n,fixedFile)=>{
      const args=[here,'one',path.join(out,String(n)),snapshot,pool,...(fixedFile?[fixedFile]:[])];
      const r=spawnSync(process.execPath,args,{stdio:'inherit',timeout:8*60*1000});
      if(r.status!==0) throw new Error('Browser check failed');
    };
    runOne(1);
    // Second independent process checks exactly the ASINs the first one inspected.
    const first=read(path.join(out,'1/result.json'));
    if(first.stoppedOnAccessBlock){
      const status={at:first.finishedAt,checked:first.details.length,verified:0,publishedNew:0,blocked:true,
        status:'ACCESS_BLOCKED',secondPass:'NOT_ATTEMPTED_AFTER_ACCESS_BLOCK'};
      fs.writeFileSync(path.join(out,'status.json'),JSON.stringify(status,null,2)+'\n');
      console.log(JSON.stringify(status));process.exitCode=10;
    }else{
    const targetsFile=path.join(out,'targets.json');
    fs.writeFileSync(targetsFile,JSON.stringify({targets:first.details.map(d=>d.asin)},null,2)+'\n');
    runOne(2,targetsFile);
    const a=read(path.join(out,'1/result.json')),b=read(path.join(out,'2/result.json'));
    const previous=read(snapshot),next=adoptAmazon(previous,a,b);
    const targets=targetConsistency(a,b);
    const marked=markUnconfirmed(read(pool),a,b,b.finishedAt);
    fs.writeFileSync(pool+'.tmp',JSON.stringify(marked,null,2)+'\n');fs.renameSync(pool+'.tmp',pool);
    const status={at:b.finishedAt,checked:b.details.length,verified:verifiedRows(a,b).length,targets,
      unconfirmedCarriedOver:marked.items.filter(x=>x.unconfirmed).length,
      publishedNew:next===previous?0:next.sources.amazon.lastRunNewAsins,
      blocked:[a,b].some(r=>[...r.searches,...r.details].some(d=>d.stage==='BLOCKED')),
      unconfirmedThisRun:new Set([...a.details,...b.details].map(d=>d.asin)).size-verifiedRows(a,b).length,
      status:next===previous?'NO_VERIFIED_UPDATE':'VERIFIED_UPDATE'};
    fs.writeFileSync(path.join(out,'status.json'),JSON.stringify(status,null,2)+'\n');
    console.log(JSON.stringify(status));
    if(next===previous) process.exitCode=10;
    else {fs.writeFileSync(snapshot+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(snapshot+'.tmp',snapshot);}
    }
  } else throw new Error('Usage: update-live.mjs all output snapshot pool');
}
