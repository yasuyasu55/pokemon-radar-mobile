import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {run} from './browser-probe.mjs';
export function verifiedRows(a,b) {
  if(a.mode!=='BROWSER_POC' || b.mode!=='BROWSER_POC' || !a.pid || !b.pid || a.pid===b.pid) throw new Error('Independent live browser results required');
  return b.details.filter(y=>{
    const x=a.details.find(o=>o.asin===y.asin);
    return x?.candidate===true && y.candidate===true && x.title===y.title &&
      [x,y].every(r=>r.stage==='PRODUCT_PARSED' && r.status===200 && /^[A-Z0-9]{10}$/.test(r.asin) &&
        r.url===`https://www.amazon.co.jp/dp/${r.asin}` && /ポケモンカード/.test(r.title) &&
        ['asinMatched','amazonSeller','invitationNotice','requestButton'].every(k=>r.checks?.[k]===true));
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
    const prior=read(snapshot),items=fs.existsSync(pool)?read(pool).items:[];
    const published=prior.cases.filter(c=>c.id.startsWith('amazon:')).map(c=>c.asin || c.id.split(':')[1]);
    const candidates=items.filter(x=>x.state!=='retired').map(x=>x.asin);
    await run(out,[...new Set([...candidates,...published])]);
  } else if(action==='all') {
    fs.mkdirSync(out,{recursive:true});
    for(const n of [1,2]) {
      const r=spawnSync(process.execPath,[here,'one',path.join(out,String(n)),snapshot,pool],{stdio:'inherit',timeout:8*60*1000});
      if(r.status!==0) throw new Error('Browser check failed');
    }
    const a=read(path.join(out,'1/result.json')),b=read(path.join(out,'2/result.json'));
    const previous=read(snapshot),next=adoptAmazon(previous,a,b);
    const status={at:b.finishedAt,checked:b.details.length,verified:verifiedRows(a,b).length,
      publishedNew:next===previous?0:next.sources.amazon.lastRunNewAsins,
      blocked:b.details.some(d=>d.stage==='BLOCKED'),status:next===previous?'NO_VERIFIED_UPDATE':'VERIFIED_UPDATE'};
    fs.writeFileSync(path.join(out,'status.json'),JSON.stringify(status,null,2)+'\n');
    console.log(JSON.stringify(status));
    if(next===previous) process.exitCode=10;
    else {fs.writeFileSync(snapshot+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(snapshot+'.tmp',snapshot);}
  } else throw new Error('Usage: update-live.mjs all output snapshot pool');
}
