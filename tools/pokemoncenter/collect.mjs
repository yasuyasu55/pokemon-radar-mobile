import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHttpsFetcher,parseRobots,isPathAllowed} from '../otakara-dryrun/core/http.mjs';
import {htmlToText,extractAnchors,decodeBody} from '../otakara-dryrun/core/htmlText.mjs';
import {findDateTimes,resolveDateTime} from '../otakara-dryrun/core/dates.mjs';

export const ENTRY='https://www.pokemoncenter-online.com/';
const LABELS=['抽選応募受付期間','抽選結果発表日','注文期間','お届け時期'];
export function discover(html){
 const found=[];
 for(const a of extractAnchors(html)){
  const u=new URL(a.href,ENTRY),id=u.searchParams.get('id');
  if(u.origin!==new URL(ENTRY).origin||u.pathname!=='/news/'||!/^20\d{6}$/.test(id??''))continue;
  if(!/ポケモンカードゲーム/.test(a.text)||!/抽選販売/.test(a.text)||/手順|お詫び|購入できない/.test(a.text))continue;
  u.search='?id='+id;
  if(!found.some(x=>x.url===u.href))found.push({url:u.href,title:a.text,id});
 }
 return found.sort((a,b)=>b.id.localeCompare(a.id)).slice(0,1);
}
export function scheduleImage(html,url){
 const part=html.split('【各種の期間詳細】')[1]?.split('【応募枠の違いについて】')[0];
 const urls=[...(part??'').matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m=>new URL(m[1],url));
 if(urls.length!==1||urls[0].origin!==new URL(ENTRY).origin||!urls[0].pathname.endsWith('.png'))throw new Error('日程表画像を一意に特定できません');
 return urls[0].href;
}
export function parseTables(tables,year){
 if(!Number.isInteger(year)||year<2020||year>2100||!tables.length)throw new Error('掲載年・表未取得');
 return tables.map(table=>{
  const title=table.title.normalize('NFKC').match(/ポケモンカードゲーム\s*MEGA\s*拡張パック\s*「([^」]+)」/);
  if(!title)throw new Error('商品名を読み取れません');
  if(table.labels.map(x=>x.replace(/\s/g,'')).join('|')!==LABELS.join('|'))throw new Error('日程ラベル不一致');
  const periods=table.values.map((raw,i)=>{
   const dates=findDateTimes(raw.normalize('NFKC'));
   const alt=findDateTimes(table.alternate[i].normalize('NFKC'));
   const key=d=>[d.year,d.month,d.day,d.weekday,d.hour,d.minute];
   if(JSON.stringify(dates.map(key))!==JSON.stringify(alt.map(key)))throw new Error('OCR方式間で日時不一致');
   if(dates.length!==(i===1?1:2))throw new Error('必要な日時数を読み取れません');
   const resolved=dates.map(d=>{
    if(!d.weekday)throw new Error('曜日の検算不可');
    const r=resolveDateTime(d,year);
    if(r.reason||r.weekdayMatches!==true||(i<3&&!r.iso))throw new Error('日時・曜日・時刻の検証失敗');
    // 年は画像にないため、掲載年を補助値として明示。既存の年継承注記とは区別する。
    r.notes=d.year?[]:['年は公式案内の掲載年から補助。画像には年の記載なし・曜日一致'];
    r.yearBasis=d.year?'IMAGE':'ARTICLE_PUBLICATION';
    return r;
   });
   if(resolved.length===2&&resolved[0].date>resolved[1].date)throw new Error('期間の順序不正');
   return {raw,start:resolved[0],end:resolved[1]??null,status:resolved.some(x=>x.inferredYear)?'INFERRED':'CONFIRMED',notBefore:i===1&&/以降/.test(raw)};
  });
  if(periods[0].end.iso>periods[1].start.iso||periods[1].start.iso>periods[2].start.iso)throw new Error('応募・発表・注文の順序不正');
  return {title:'ポケモンカードゲーム MEGA 拡張パック「'+title[1]+'」',rawTitle:table.title,entryPeriod:periods[0],resultAnnouncement:periods[1],purchasePeriod:periods[2],shippingPeriod:periods[3]};
 });
}
export async function collect(fetcher,ocr){
 const ledger=[];let stage='FETCH';
 async function get(url){const r=await fetcher(url);const {body,...record}=r;ledger.push(record);if(!r.ok)throw new Error(r.error??'取得失敗');return r;}
 try{
  const rb=await get(new URL('robots.txt',ENTRY).href),rules=parseRobots(decodeBody(rb.body,rb.headers['content-type']).text,'PokemonRadar');
  async function allowed(url){const u=new URL(url);if(!isPathAllowed(rules,u.pathname+u.search))throw new Error('robotsで禁止');return get(url);}
  const home=await allowed(ENTRY),news=discover(decodeBody(home.body,home.headers['content-type']).text);
  if(!news.length)throw new Error('抽選案内未発見。募集なしとは扱いません');
  const article=await allowed(news[0].url),html=decodeBody(article.body,article.headers['content-type']).text;
  const text=htmlToText(html.slice(html.indexOf('<h1')));
  const publication=html.match(/<p class="time">(20\d{2})年(\d{2})月(\d{2})日/);
  if(!publication||!/商品のお届け先は、日本国内に限/.test(text))throw new Error('掲載日・国内配送条件未確認');
  const imageUrl=scheduleImage(html,news[0].url),img=await allowed(imageUrl);
  if(!/^image\/png/.test(img.headers['content-type']??''))throw new Error('画像Content-Type不正');
  stage='OCR';const rawTables=await ocr(img.body);stage='VERIFY';
  const cases=parseTables(rawTables,Number(publication[1])).map(c=>({...c,sourceUrl:news[0].url,scheduleImageUrl:imageUrl,receivingMethod:'DELIVERY',receivingLabel:'日本国内への配送',applicationMethod:'ポケモンセンターオンラインで応募',webApplicationUrl:null,
   applicationConditions:text.slice(text.indexOf('【応募枠の違いについて】'),text.indexOf('【商品の注文方法について')),
   unknowns:['あなたの本人認証・応募資格','商品ごとの応募ページURL'],fetchedAt:new Date().toISOString()}));
  return {ok:true,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),coverage:'公式トップから発見した最新のポケカ抽選案内1記事。画像の4項目表のみ対応',cases,rawTables,ledger};
 }catch(e){return {ok:false,mode:'LIVE',pid:process.pid,stage,error:e.message,cases:null,ledger};}
}
function runOcr(body){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pco-ocr-'));
 try{const file=path.join(tmp,'schedule.png');fs.writeFileSync(file,body);const r=spawnSync('python3',[fileURLToPath(new URL('ocr.py',import.meta.url)),file],{encoding:'utf8',timeout:180000});if(r.status!==0)throw new Error(r.stderr??'OCR失敗');return JSON.parse(r.stdout);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
export function compare(a,b){
 const norm=r=>JSON.stringify(r.cases.map(({fetchedAt,...c})=>c));
 if(!a.ok||!b.ok||a.mode!=='LIVE'||b.mode!=='LIVE'||a.pid===b.pid||!a.cases?.length||norm(a)!==norm(b))throw new Error('独立2回の実取得・抽出照合不成立');
 return {ok:true,cases:b.cases.length,requests:b.ledger.length,hashesMatch:a.ledger.length===b.ledger.length&&a.ledger.every((r,i)=>r.requestedUrl===b.ledger[i].requestedUrl&&r.sha256===b.ledger[i].sha256),notice:'dry-runのみ。公開データ・DB・応募履歴は変更しません'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,target]=process.argv.slice(2);fs.mkdirSync(target,{recursive:true});
 if(action==='run'){
  const r=await collect(createHttpsFetcher({allowedHosts:['www.pokemoncenter-online.com'],maxBytes:8*1024*1024,userAgent:'PokemonRadar/0.1 (+public lottery information check)'}),runOcr);
  fs.writeFileSync(path.join(target,'result.json'),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify({ok:r.ok,pid:r.pid,cases:r.cases?.map(c=>({title:c.title,deadline:c.entryPeriod.end.iso,resultNotBefore:c.resultAnnouncement.start.iso,purchaseDeadline:c.purchasePeriod.end.iso,shippingStart:c.shippingPeriod.start.date,shippingEnd:c.shippingPeriod.end.date,yearBasis:c.entryPeriod.start.yearBasis}))??null,requests:r.ledger.map(x=>({url:x.requestedUrl,status:x.status,bytes:x.bytes,sha256:x.sha256})),stage:r.stage,error:r.error}));process.exitCode=r.ok?0:10;
 }else if(action==='all'){
  for(let i=1;i<=2;i++){const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'run',path.join(target,'run-'+i)],{stdio:'inherit'});if(r.status!==0){process.exitCode=r.status??99;break;}if(i===1)await new Promise(r=>setTimeout(r,20000));}
  if(!process.exitCode){const read=i=>JSON.parse(fs.readFileSync(path.join(target,'run-'+i,'result.json'),'utf8'));try{const report=compare(read(1),read(2));fs.writeFileSync(path.join(target,'comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}catch(e){console.error(e.message);process.exitCode=20;}}
 }else throw new Error('run/all only');
}
