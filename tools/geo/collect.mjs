import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHttpsFetcher,parseRobots,isPathAllowed} from '../otakara-dryrun/core/http.mjs';
import {extractAnchors,extractTitles,htmlToText,pickArticleScope,decodeBody} from '../otakara-dryrun/core/htmlText.mjs';
import {findDateTimes,resolveDateTime} from '../otakara-dryrun/core/dates.mjs';

export const ENTRY='https://geo-online.co.jp/news/';
export const MAX_ARTICLES=5;

function publishedDateOf(text){
  const m=text.match(/(20\d{2})[./年](\d{1,2})[./月](\d{1,2})日?/);
  return m?`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:null;
}
function near(lines,labelRe,count=8){
  const i=lines.findIndex(l=>labelRe.test(l));
  return i<0?null:lines.slice(i,i+count).join(' ');
}
function rangeFromSegment(seg,fallbackYear,label){
  if(!seg)return null;
  const dts=findDateTimes(seg);
  if(dts.length<2)return null;
  let start=resolveDateTime(dts[0],fallbackYear);
  let endYear=start.date?Number(start.date.slice(0,4)):fallbackYear;
  if(dts[1].year==null&&start.date&&dts[1].month<dts[0].month&&dts[0].month>=11)endYear++;
  const end=resolveDateTime(dts[dts.length-1],endYear);
  if(!start.date||!end.date||start.reason||end.reason)return null;
  return {found:true,raw:seg,start,end,deadlineOnly:false,status:(start.inferredYear||end.inferredYear)?'INFERRED':'CONFIRMED',notes:[...(start.notes||[]),...(end.notes||[]),label]};
}
function singleFromSegment(seg,fallbackYear){
  if(!seg)return null;
  const dt=findDateTimes(seg)[0]; if(!dt)return null;
  const start=resolveDateTime(dt,fallbackYear);
  if(!start.date||start.reason)return null;
  return {found:true,raw:seg,start,end:null,deadlineOnly:false,single:true,approximate:/頃|以降|順次/.test(seg),status:start.inferredYear?'INFERRED':'CONFIRMED',notes:start.notes||[]};
}
export function discover(html){
  const out=[];
  for(const a of extractAnchors(html)){
    let u;try{u=new URL(a.href,ENTRY);}catch{continue;}
    if(u.origin!=='https://geo-online.co.jp'||!/^\/news\/\d+\/?$/.test(u.pathname))continue;
    const label=(a.text||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!/ポケモンカードゲーム|ポケモンカード/.test(label)||!/抽選販売|抽選/.test(label))continue;
    if(/よくあるお問い合わせ|FAQ/.test(label))continue;
    u.search='';u.hash='';
    if(!out.some(x=>x.url===u.href))out.push({url:u.href,title:label});
  }
  return out.slice(0,MAX_ARTICLES);
}
export function extractCase(html,url,fetchedAt){
  const scope=pickArticleScope(html);
  const text=htmlToText(scope.html||html),lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  const title=(extractTitles(scope.html||html).h1||extractTitles(html).h1||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  if(!/ポケモンカードゲーム|ポケモンカード/.test(title)||!/抽選販売|抽選/.test(title))throw new Error('GEOのポケカ抽選記事ではありません');
  const publishedDate=publishedDateOf(text);
  if(!publishedDate)throw new Error('掲載日を確認できません');
  const year=Number(publishedDate.slice(0,4));
  const entry=rangeFromSegment(near(lines,/応募(?:受付)?期間|抽選受付期間|応募期間/),year,'GEO公式の応募期間');
  if(!entry?.end?.date)throw new Error('応募期間を確定できません');
  const result=singleFromSegment(near(lines,/当選(?:発表|結果|連絡)/),year);
  const purchase=rangeFromSegment(near(lines,/(?:購入|販売|受取)(?:期間|可能期間)|当選者.*購入/),year,'GEO公式の購入・受取期間');
  const conditions=lines.filter(l=>/Ponta|GEO ID|ゲオアプリ|本人確認|レンタル会員|応募|当選|購入店舗|受取店舗|身分証/.test(l)&&l.length>=8&&l.length<=280).slice(0,20);
  const articleAnchors=extractAnchors(scope.html||html);
  const apply=articleAnchors.find(a=>/応募|抽選販売専用サイト|お申し込み/.test(a.text)&&/^https?:/.test(a.href));
  const id='geo:'+new URL(url).pathname.replace(/\/$/,'').split('/').pop();
  return {
    id,sourceId:'geo',title,sourceName:'GEO',sourceUrl:url,fetchedAt,publishedDate,
    entryPeriod:entry,resultAnnouncement:result,purchasePeriod:purchase,
    applicationMethod:'ゲオ抽選販売専用サイト（GEO IDでログイン）',
    webApplicationUrl:apply?.href??null,webApplicationLabel:apply?'ゲオ公式の応募ページ':'ゲオ公式案内から応募ページを確認',
    applicationNote:'GEO ID・Ponta連携等の条件を公式案内で確認して応募してください。',
    receivingMethod:'STORE_ONLY',receivingLabel:'店頭購入・受取',storeSelectionNote:'当選後は指定店舗での本人確認・購入条件を確認',
    resultNote:result?'公式案内記載の当選発表を確認':'当選発表日時は公式案内で確認',
    stores:[],prices:[],conditions:[...new Set(conditions)],handoverRestrictions:[],
    unknowns:[...(result?[]:['当選発表日時']),...(purchase?[]:['購入・受取期間']),'あなたの応募資格・応募状況'],
    evidence:{entry:entry.raw,result:result?.raw??null,purchase:purchase?.raw??null},
    verification:'GEO公式ニュース一覧と個別記事を通常HTTPで独立2回取得し、抽出値を照合'
  };
}
export async function collect(fetcher){
  const ledger=[];
  async function raw(url){const r=await fetcher(url);const{body,...record}=r;ledger.push(record);if(!r.ok)throw new Error(r.error??('HTTP '+r.status));return decodeBody(body,r.headers['content-type']).text;}
  try{
    const robots=await raw('https://geo-online.co.jp/robots.txt');
    const rules=parseRobots(robots,'PokemonRadar');
    async function allowed(url){const u=new URL(url);if(u.origin!=='https://geo-online.co.jp')throw new Error('許可外ホスト');if(!isPathAllowed(rules,u.pathname+u.search))throw new Error('robotsで禁止されたURL');return raw(url);}
    const list=await allowed(ENTRY),candidates=discover(list);
    if(!candidates.length)throw new Error('GEO公式ニュースからポケカ抽選記事を発見できません。0件とは扱いません');
    const cases=[],rejected=[];
    for(const c of candidates){try{cases.push(extractCase(await allowed(c.url),c.url,new Date().toISOString()));}catch(e){rejected.push({url:c.url,title:c.title,reason:e.message});}}
    if(!cases.length)throw new Error('GEO抽選案件を確定できません');
    return {ok:true,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),coverage:'GEO公式ニュース一覧から最新のポケモンカード抽選販売記事を最大5件確認',cases,rejected,ledger};
  }catch(e){return {ok:false,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),error:e.message,cases:null,ledger};}
}
const norm=r=>JSON.stringify(r.cases.map(({fetchedAt,...c})=>c).sort((a,b)=>a.id.localeCompare(b.id)));
export function merge(previous,a,b){
  if(!a.ok||!b.ok||a.mode!=='LIVE'||b.mode!=='LIVE'||a.pid===b.pid||!a.cases?.length||norm(a)!==norm(b))throw new Error('独立2回の実取得・抽出照合が不成立。前回保持');
  const ids=new Set(b.cases.map(c=>c.id));
  const kept=previous.cases.filter(c=>!ids.has(c.id)).map(c=>c.sourceId==='geo'?{...c,retainedFromPrevious:true}:c);
  return {...previous,cases:[...kept,...b.cases],sources:{...(previous.sources??{}),geo:{name:'GEO',fetchedAt:b.finishedAt,coverage:b.coverage,verifiedCases:b.cases.length,evidence:[a,b].map(r=>({pid:r.pid,requests:r.ledger.map(e=>({url:e.requestedUrl,status:e.status,bytes:e.bytes,sha256:e.sha256}))}))}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,target]=process.argv.slice(2);
 if(action==='run'){const r=await collect(createHttpsFetcher({allowedHosts:['geo-online.co.jp'],maxBytes:4*1024*1024,userAgent:'PokemonRadar/0.1 (+public lottery information check)'}));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(r,null,2)+'\n');process.exitCode=r.ok?0:10;}
 else if(action==='all'){fs.mkdirSync(target,{recursive:true});for(let i=1;i<=2;i++){const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'run',path.join(target,'run-'+i+'.json')],{stdio:'inherit'});if(r.status!==0){process.exitCode=r.status??99;break;}if(i===1)await new Promise(r=>setTimeout(r,15000));}}
 else if(action==='adopt'){const file=process.argv[4],read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const next=merge(read(file),read(path.join(target,'run-1.json')),read(path.join(target,'run-2.json')));fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(file+'.tmp',file);console.log('GEO '+next.sources.geo.verifiedCases+'件を照合・追加');}
 else throw new Error('run/all/adopt');
}
