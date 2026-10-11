import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHttpsFetcher,parseRobots,isPathAllowed} from '../otakara-dryrun/core/http.mjs';
import {extractAnchors,extractTitles,htmlToText,decodeBody,decodeEntities} from '../otakara-dryrun/core/htmlText.mjs';
import {parsePeriodAfterLabel} from '../otakara-dryrun/core/dates.mjs';

export const ENTRY='https://books.rakuten.co.jp/event/game/card/entry/';
export const ENTRY_LEGACY='https://books.rakuten.co.jp/event/game/card/entry/index-sp.html?slide=modal';
export const SEARCH='https://books.rakuten.co.jp/search?g=006&sitem=%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3%E3%82%AB%E3%83%BC%E3%83%89%E3%82%B2%E3%83%BC%E3%83%A0+%E6%8A%BD%E9%81%B8';
export const MAX_DETAILS=30;

function labelOf(a){
 const alt=[...(a.rawInner??'').matchAll(/\balt=["']([^"']+)["']/gi)].map(m=>m[1]).join(' ');
 return (a.text+' '+alt).normalize('NFKC').replace(/\s+/g,' ').trim();
}
export function discover(html,base=ENTRY){
 const out=[];
 for(const a of extractAnchors(html)){
  let u;try{u=new URL(a.href,base);}catch{continue;}
  const m=u.pathname.match(/^\/rb\/(\d+)\/?$/);
  if(u.origin!=='https://books.rakuten.co.jp'||!m)continue;
  const label=labelOf(a);
  if(label&&!/ポケモン/.test(label))continue;
  u.search='';u.hash='';
  if(!out.some(x=>x.id===m[1]))out.push({id:m[1],url:u.href,label});
 }
 return out;
}

function imageProducts(html){
 const out=[];
 for(const m of html.matchAll(/<img\b[^>]*>/gi)){
  const tag=m[0];
  const src=(tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]??'').normalize('NFKC');
  const alt=decodeEntities(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1]??'').normalize('NFKC').replace(/\s+/g,' ').trim();
  const jan=src.match(/\/(\d{13})\.(?:jpe?g|png|webp)(?:[?#]|$)/i)?.[1];
  if(!jan||!/ポケモンカードゲーム/.test(alt))continue;
  if(!out.some(x=>x.jan===jan))out.push({jan,title:alt});
 }
 return out;
}

export function extractEntryCases(html,fetchedAt){
 const text=htmlToText(html);
 const products=imageProducts(html);
 if(!products.length)throw new Error('抽選受付ページの商品を特定できません');
 const entry=requiredPeriod(text,'抽選受付期間\\s*[:：|]?');
 const result=parsePeriodAfterLabel(text,'当選連絡予定日\\s*[:：|]?');
 if(!result.found||!result.start?.date)throw new Error('当選連絡予定日を確認できません');
 const shippingLine=text.split('\n').find(l=>/商品発送予定日/.test(l));
 if(!shippingLine)throw new Error('商品発送予定を確認できません');
 const conditions=text.split('\n').filter(l=>/注文履歴|楽天会員|1商品あたり1回|1世帯1名|法人|転売目的|住所|送付先|配送方法|店頭受取|郵便局受取|当選時|落選/.test(l)&&l.length>=8&&l.length<=260).slice(0,18);
 if(!conditions.length)throw new Error('抽選条件を確認できません');
 return products.map(p=>({
  id:'rakutenbooks:jan:'+p.jan,sourceId:'rakutenbooks',title:p.title,sourceName:'楽天ブックス',sourceUrl:ENTRY,fetchedAt,publishedDate:null,
  entryPeriod:entry,
  resultAnnouncement:{raw:result.raw,start:result.start,end:null,deadlineOnly:false,single:true,approximate:true,status:result.status,notes:['公式抽選受付ページの当選連絡予定日を保持。時刻は補完しない']},
  purchasePeriod:null,
  shippingPeriod:{raw:shippingLine.replace(/^.*?商品発送予定日\s*[:：|]?\s*/, '').trim(),start:null,end:null,approximate:false,status:'UNCONFIRMED',notes:['当選者への案内のみ。発送日を推測しない']},
  applicationMethod:'楽天ブックス公式のポケモンカード抽選受付ページからエントリー',webApplicationUrl:ENTRY,webApplicationLabel:'楽天ブックス公式 抽選受付ページ',
  applicationNote:'楽天会員で公式抽選受付ページからエントリー。ページ記載の注文履歴・住所等の応募条件を確認してください。',
  receivingMethod:'DELIVERY',receivingLabel:'配送',storeSelectionNote:'配送案件。コンビニ店頭受取・郵便局受取は利用不可',
  resultNote:'当選者のみにメールで案内。落選時は連絡なし。正確な送信時刻は未確認',
  stores:[],prices:[],conditions:[...new Set(conditions)],handoverRestrictions:[],
  unknowns:['あなたの楽天会員としての応募資格・応募状況','当選メールの正確な送信時刻','商品発送の具体的な日付'],
  evidence:{entry:entry.raw,result:result.raw,shipping:shippingLine,jan:p.jan},
  verification:'楽天ブックス公式のポケモンカード抽選受付ページを通常HTTPで独立2回取得し、商品コード・抽選期間・当選連絡予定日を照合'
 }));
}
function requiredPeriod(text,label){
 const p=parsePeriodAfterLabel(text,label);
 if(!p.found||!p.start?.date||!p.end?.date||!p.start.iso||!p.end.iso||p.start.reason||p.end.reason)throw new Error('日程を確定できません: '+label);
 if(p.start.iso>p.end.iso)throw new Error('期間順序不正: '+label);
 return p;
}
function shippingRaw(text){
 const line=text.split('\n').find(l=>/発送予定日\s*[:：]/.test(l));
 return line?line.replace(/^.*?発送予定日\s*[:：]?\s*/,'').trim():null;
}
export function extractCase(html,url,fetchedAt){
 const text=htmlToText(html),titles=extractTitles(html);
 const rbId=new URL(url).pathname.match(/^\/rb\/(\d+)\/?$/)?.[1];
 if(!rbId)throw new Error('楽天ブックス商品URLではありません');
 const title=(titles.h1||titles.ogTitle||titles.title||'').replace(/\s*[-|｜].*楽天ブックス.*$/,'').trim();
 if(!/ポケモン/.test(title)||!/カード/.test(title))throw new Error('ポケモンカード商品ではありません');
 if(!/【抽選商品について】|\[抽選商品について\]|抽選販売スケジュール/.test(text))throw new Error('抽選商品表記なし');
 const entry=requiredPeriod(text,'抽選受付期間\\s*[:：]?');
 const purchase=requiredPeriod(text,'当選者販売期間\\s*[:：]?');
 if(entry.end.iso>purchase.start.iso)throw new Error('応募終了と販売開始の順序不正');
 const resultLine=text.split('\n').find(l=>/当落の結果.*販売開始日まで.*メール/.test(l));
 if(!resultLine)throw new Error('当落通知方法未確認');
 const shipping=shippingRaw(text);
 if(!shipping)throw new Error('発送予定未確認');
 const receivingLines=text.split('\n').filter(l=>/お届け先|配送方法|発送予定/.test(l)).slice(0,8);
 if(!receivingLines.length)throw new Error('配送条件未確認');
 const conditions=text.split('\n').filter(l=>/エントリー|会員|お届け先|支払い方法|クーポン|キャンセル|返品|当選者/.test(l)&&l.length>=8&&l.length<=240).slice(0,12);
 return {
  id:'rakutenbooks:'+rbId,sourceId:'rakutenbooks',title,sourceName:'楽天ブックス',sourceUrl:url,fetchedAt,publishedDate:null,
  entryPeriod:entry,
  resultAnnouncement:{raw:resultLine,start:structuredClone(purchase.start),end:null,deadlineOnly:false,single:true,approximate:false,notAfter:true,status:'CONFIRMED',notes:['当落通知の正確な時刻は未確認。公式記載は当選者販売開始日まで']},
  purchasePeriod:purchase,
  shippingPeriod:{raw:shipping,start:null,end:null,approximate:true,status:'UNCONFIRMED',notes:['発送予定の原文を保持。日付範囲は推測しない']},
  applicationMethod:'楽天ブックスで抽選エントリー',webApplicationUrl:url,webApplicationLabel:'公式の商品詳細ページから応募条件を確認',
  applicationNote:'楽天ブックスへログインし、商品詳細の抽選案内から手続きしてください。このリンクを開くだけでは応募されません。',
  receivingMethod:'DELIVERY',receivingLabel:'配送',storeSelectionNote:'楽天ブックスの注文として配送。応募時の会員情報・配送条件を確認',
  resultNote:'当落結果は当選者販売開始日までにメールで連絡。正確な通知時刻は未確認',
  stores:[],prices:[],conditions:[...new Set(conditions)],handoverRestrictions:[],
  unknowns:['あなたの楽天会員としての応募資格・応募状況','当落メールの正確な送信時刻'],
  evidence:{entry:entry.raw,result:resultLine,purchase:purchase.raw,receiving:[...receivingLines,'発送予定: '+shipping]},
  verification:'楽天ブックス公式の商品詳細を通常HTTPで独立2回取得し、抽出値を照合'
 };
}
export async function collect(fetcher){
 const ledger=[];
 async function raw(url){
  const r=await fetcher(url);const{body,...record}=r;ledger.push(record);
  if(!r.ok)throw new Error(r.error??('HTTP '+r.status));
  return decodeBody(body,r.headers['content-type']).text;
 }
 try{
  const robots=await raw('https://books.rakuten.co.jp/robots.txt');
  const rules=parseRobots(robots,'PokemonRadar');
  async function allowed(url){
   const u=new URL(url);
   if(u.origin!=='https://books.rakuten.co.jp')throw new Error('許可外ホスト');
   if(!isPathAllowed(rules,u.pathname+u.search))throw new Error('robotsで禁止されたURL');
   return raw(url);
  }
  const entryHtml=await allowed(ENTRY);
  const entryCases=extractEntryCases(entryHtml,new Date().toISOString());
  let candidates=discover(entryHtml,ENTRY),discovery='OFFICIAL_LOTTERY_ENTRY_DIRECT';
  if(!candidates.length){
   const searchHtml=await allowed(SEARCH);
   candidates=discover(searchHtml,SEARCH);discovery='OFFICIAL_ENTRY_PLUS_SEARCH';
  }
  if(!candidates.length&&!entryCases.length)throw new Error('公式ページから商品候補を発見できません。0件とは扱いません');
  const parsed=[],rejected=[];
  for(const c of candidates.slice(0,MAX_DETAILS)){
   try{parsed.push(extractCase(await allowed(c.url),c.url,new Date().toISOString()));}
   catch(e){rejected.push({id:c.id,url:c.url,reason:e.message});}
  }
  const merged=new Map();
  for(const item of [...entryCases,...parsed]){
   const key=item.title.normalize('NFKC').replace(/【[^】]*】|\s+/g,'').toLowerCase();
   if(!merged.has(key)||item.id.startsWith('rakutenbooks:jan:'))merged.set(key,item);
  }
  const cases=[...merged.values()].sort((a,b)=>a.id.localeCompare(b.id));
  if(!cases.length)throw new Error('楽天ブックス抽選案件を確定できません');
  return {ok:true,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),
   coverage:'楽天ブックス公式のポケモンカード抽選受付ページを直接案件化。受付ページの商品コード・抽選期間・当選連絡予定日を採用し、公式検索と商品詳細の抽選販売情報も補助的に統合',
   discovery,candidates:candidates.length,entryCases:entryCases.length,checked:Math.min(candidates.length,MAX_DETAILS),cases,rejected,ledger};
 }catch(e){return {ok:false,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),error:e.message,cases:null,ledger};}
}
const normalized=r=>JSON.stringify(r.cases.map(({fetchedAt,...c})=>c).sort((a,b)=>a.id.localeCompare(b.id)));
export function compare(a,b){
 if(!a.ok||!b.ok||a.mode!=='LIVE'||b.mode!=='LIVE'||a.pid===b.pid||!a.cases?.length||normalized(a)!==normalized(b))throw new Error('独立2回の実取得・抽出照合不成立');
 return {ok:true,cases:b.cases.length,discovery:b.discovery,requests:b.ledger.length,notice:'一致した検証済み案件だけ採用可能'};
}
export function merge(previous,a,b){
 compare(a,b);
 if(previous.schemaVersion!==1||!Array.isArray(previous.cases))throw new Error('前回形式不正');
 const ids=new Set();
 for(const c of b.cases){
  if(c.sourceId!=='rakutenbooks'||!/^rakutenbooks:(?:\d+|jan:\d{13})$/.test(c.id)||ids.has(c.id)||new URL(c.sourceUrl).origin!=='https://books.rakuten.co.jp'||c.receivingMethod!=='DELIVERY'||!c.entryPeriod?.end?.iso||(!c.id.startsWith('rakutenbooks:jan:')&&!c.purchasePeriod?.end?.iso)||!c.conditions?.length)throw new Error('採用項目不正');
  ids.add(c.id);
 }
 const kept=previous.cases.filter(c=>!ids.has(c.id)).map(c=>c.sourceId==='rakutenbooks'?{...c,retainedFromPrevious:true}:c);
 return {...previous,cases:[...kept,...b.cases],sources:{...(previous.sources??{}),rakutenbooks:{name:'楽天ブックス',fetchedAt:b.finishedAt,coverage:b.coverage,verifiedCases:b.cases.length,discovery:b.discovery,evidence:[a,b].map(r=>({pid:r.pid,requests:r.ledger.map(e=>({url:e.requestedUrl,status:e.status,bytes:e.bytes,sha256:e.sha256,contentType:e.headers?.['content-type']}))}))}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,target]=process.argv.slice(2);
 if(action==='run'){
  const r=await collect(createHttpsFetcher({allowedHosts:['books.rakuten.co.jp'],maxBytes:4*1024*1024,userAgent:'PokemonRadar/0.1 (+public lottery information check)'}));
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify({ok:r.ok,pid:r.pid,discovery:r.discovery,candidates:r.candidates,checked:r.checked,cases:r.cases?.map(c=>({id:c.id,title:c.title,entryEnd:c.entryPeriod.end.iso,purchaseEnd:c.purchasePeriod.end.iso,shipping:c.shippingPeriod.raw}))??null,error:r.error,requests:r.ledger.map(x=>({url:x.requestedUrl,status:x.status,bytes:x.bytes,sha256:x.sha256}))}));
  process.exitCode=r.ok?0:10;
 }else if(action==='all'){
  fs.mkdirSync(target,{recursive:true});
  for(let i=1;i<=2;i++){
   const out=path.join(target,'run-'+i+'.json');
   const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'run',out],{stdio:'inherit'});
   if(r.status!==0){process.exitCode=r.status??99;break;}
   if(i===1)await new Promise(r=>setTimeout(r,15000));
  }
  if(!process.exitCode){
   const read=i=>JSON.parse(fs.readFileSync(path.join(target,'run-'+i+'.json'),'utf8'));
   try{const report=compare(read(1),read(2));fs.writeFileSync(path.join(target,'comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
   catch(e){console.error(e.message);process.exitCode=20;}
  }
 }else if(action==='adopt'){
  const snapshot=process.argv[4],read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
  const next=merge(read(snapshot),read(path.join(target,'run-1.json')),read(path.join(target,'run-2.json')));
  fs.writeFileSync(snapshot+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(snapshot+'.tmp',snapshot);
  console.log('楽天ブックス抽選 '+next.sources.rakutenbooks.verifiedCases+'件を照合・追加');
 }else throw new Error('run/all/adopt');
}
