import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const RECENT_CLOSED_DAYS=14;
const BROAD_QUERIES=[
  'ポケモンカードゲーム BOX 招待',
  'ポケモンカードゲーム 拡張パック BOX 招待',
  'ポケモンカードゲーム ハイクラスパック BOX 招待',
  'ポケモンカードゲーム スターターセット 招待',
  'ポケモンカードゲーム プレミアムデッキセット 招待',
  'ポケモンカードゲーム カードセット 招待',
  'ポケモンカード 招待販売'
];

const OFFICIAL_PRIORITY_PRODUCTS=[
  '30th CELEBRATION',
  'ストームエメラルダ',
  'アビスアイ',
  'ニンジャスピナー',
  'ムニキスゼロ',
  'MEGAドリームex',
  'インフェルノX',
  'メガブレイブ',
  'メガシンフォニア'
];

function norm(s=''){
  return s.normalize('NFKC').replace(/[「」『』]/g,' ').replace(/\s+/g,' ').trim();
}
function usefulTitle(raw){
  let s=norm(raw)
    .replace(/【[^】]*】/g,' ')
    .replace(/\[[^\]]*\]/g,' ')
    .replace(/ポケモンカードゲーム/g,' ')
    .replace(/ポケモンカード/g,' ')
    .replace(/抽選販売(?:に関して|のお知らせ|のご案内|について)?/g,' ')
    .replace(/抽選(?:販売)?/g,' ')
    .replace(/再販|再入荷|アプリ会員様限定|お知らせ|ご案内/g,' ')
    .replace(/\b\d{4}\b/g,' ')
    .replace(/\s+/g,' ').trim();
  s=s.replace(/^MEGA\s+/,'MEGA ');
  if(!s||/^(?:\d+種|商品|商品の|カード|ゲーム|セット)$/.test(s))return null;
  if(/^(?:再入荷商品|\d+種)/.test(s))return null;
  return s;
}
function caseEligible(c,nowMs){
  const end=Date.parse(c.entryPeriod?.end?.iso||'');
  const start=Date.parse(c.entryPeriod?.start?.iso||'');
  if(Number.isFinite(end)) return end >= nowMs-RECENT_CLOSED_DAYS*86400000;
  if(Number.isFinite(start)) return start >= nowMs-RECENT_CLOSED_DAYS*86400000;
  // 日程未確認でも現在のsnapshotに載る商品名が具体的なら発見種として残す。
  return true;
}
function stableSeedId(q){return createHash('sha256').update(q).digest('hex').slice(0,16);}
export function buildSeeds(snapshot,{now=new Date()}={}){
  const nowMs=now.getTime(), byQuery=new Map();
  for(const c of snapshot.cases||[]){
    if(!caseEligible(c,nowMs))continue;
    const core=usefulTitle(c.title);
    if(!core)continue;
    const variants=[
      core,
      core+' 招待'
    ];
    for(const query of variants){
      const q=norm(query);
      const row=byQuery.get(q)??{id:'seed:'+stableSeedId(q),query:q,kind:'case-derived',caseIds:[],sourceIds:[],priority:100};
      if(!row.caseIds.includes(c.id))row.caseIds.push(c.id);
      if(c.sourceId&&!row.sourceIds.includes(c.sourceId))row.sourceIds.push(c.sourceId);
      byQuery.set(q,row);
    }
  }
  for(const q of BROAD_QUERIES){
    byQuery.set(q,{id:'seed:'+stableSeedId(q),query:q,kind:'broad-safety-net',caseIds:[],sourceIds:[],priority:40});
  }
  for(const product of OFFICIAL_PRIORITY_PRODUCTS){
    const q=norm('ポケモンカードゲーム '+product+' BOX 招待');
    byQuery.set(q,{id:'seed:'+stableSeedId(q),query:q,kind:'official-priority-product',caseIds:[],sourceIds:['pokemon-card.com'],priority:85});
  }
  return {
    schemaVersion:1,
    generatedAt:now.toISOString(),
    recentClosedDays:RECENT_CLOSED_DAYS,
    seeds:[...byQuery.values()].sort((a,b)=>b.priority-a.priority||a.query.localeCompare(b.query,'ja'))
  };
}
export function buildStormHandoff(pool,{generatedAt=new Date().toISOString()}={}){
  const items=(pool.items||[]).filter(x=>x.asin&&x.state!=='retired').map(x=>({
    asin:x.asin,
    url:'https://www.amazon.co.jp/dp/'+x.asin,
    priority:x.state==='invitation-active'?100:x.state==='new'?90:x.state==='watching'?70:40,
    state:x.state||'new',
    productKey:x.productKey||null,
    lastCheckedAt:x.lastCheckedAt||null
  }));
  return {schemaVersion:1,generatedAt,consumer:'CRAWL_STORM_X',items};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [snapshotPath,seedsPath,poolPath,handoffPath]=process.argv.slice(2);
  if(!snapshotPath||!seedsPath||!poolPath||!handoffPath)throw new Error('Usage: node build-seeds.mjs snapshot seeds pool handoff');
  const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
  const seeds=buildSeeds(snapshot);
  fs.mkdirSync(path.dirname(seedsPath),{recursive:true});
  fs.writeFileSync(seedsPath,JSON.stringify(seeds,null,2)+'\n');
  let pool={schemaVersion:1,updatedAt:null,items:[]};
  if(fs.existsSync(poolPath))pool=JSON.parse(fs.readFileSync(poolPath,'utf8'));
  fs.writeFileSync(handoffPath,JSON.stringify(buildStormHandoff(pool),null,2)+'\n');
  console.log(JSON.stringify({seeds:seeds.seeds.length,caseDerived:seeds.seeds.filter(x=>x.kind==='case-derived').length,broad:seeds.seeds.filter(x=>x.kind==='broad-safety-net').length,stormTargets:pool.items?.filter(x=>x.state!=='retired').length||0}));
}
