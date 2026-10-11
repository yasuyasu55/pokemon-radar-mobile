import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHttpsFetcher,parseRobots,isPathAllowed} from '../otakara-dryrun/core/http.mjs';
import {extractAnchors,extractTitles,htmlToText,pickArticleScope,decodeBody} from '../otakara-dryrun/core/htmlText.mjs';
import {findDateTimes,resolveDateTime} from '../otakara-dryrun/core/dates.mjs';

export const ENTRY='https://shibuyatsutaya.tsite.jp/event/?article_tag=%E3%83%9D%E3%82%B1%E3%82%AB';
export const MAX_ARTICLES=5;

function near(lines,labelRe,count=10){const i=lines.findIndex(l=>labelRe.test(l));return i<0?null:lines.slice(i,i+count).join(' ');}
function range(seg,label){if(!seg)return null;const dts=findDateTimes(seg);if(dts.length<2)return null;const start=resolveDateTime(dts[0]);let year=start.date?Number(start.date.slice(0,4)):dts[0].year;const end=resolveDateTime(dts[dts.length-1],year);if(!start.date||!end.date||start.reason||end.reason)return null;return {found:true,raw:seg,start,end,deadlineOnly:false,status:(start.inferredYear||end.inferredYear)?'INFERRED':'CONFIRMED',notes:[...(start.notes||[]),...(end.notes||[]),label]};}
function single(seg){if(!seg)return null;const dt=findDateTimes(seg)[0];if(!dt)return null;const start=resolveDateTime(dt);if(!start.date||start.reason)return null;return {found:true,raw:seg,start,end:null,deadlineOnly:false,single:true,approximate:/以降|順次|頃/.test(seg),status:start.inferredYear?'INFERRED':'CONFIRMED',notes:start.notes||[]};}
export function discover(html){
 const out=[];
 for(const a of extractAnchors(html)){
  let u;try{u=new URL(a.href,ENTRY);}catch{continue;}
  if(u.origin!=='https://shibuyatsutaya.tsite.jp'||!/^\/article\/\d+\.html$/.test(u.pathname))continue;
  const label=(a.text||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  if(!/ポケモンカードゲーム/.test(label)||!/抽選販売/.test(label))continue;
  if(!out.some(x=>x.url===u.href))out.push({url:u.href,title:label});
 }
 return out.slice(0,MAX_ARTICLES);
}
export function extractCase(html,url,fetchedAt){
 const scope=pickArticleScope(html);
 const body=scope.html||html,text=htmlToText(body),lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
 const title=(extractTitles(body).h1||extractTitles(html).h1||'').normalize('NFKC').replace(/\s+/g,' ').trim();
 if(!/ポケモンカードゲーム/.test(title)||!/抽選販売/.test(title))throw new Error('SHIBUYA TSUTAYAのポケカ抽選記事ではありません');
 const entry=range(near(lines,/応募受付期間|お申込み期間|申込期間/),'SHIBUYA TSUTAYA公式の応募期間');
 if(!entry?.end?.date)throw new Error('応募期間を確定できません');
 const result=single(near(lines,/当選発表/));
 const purchase=range(near(lines,/商品受取り日程|商品受取日程|受取期間/),'SHIBUYA TSUTAYA公式の受取期間');
 const anchors=extractAnchors(body);
 const apply=anchors.find(a=>/申込み|お申し込み|申し込み|cloud-pass/i.test((a.text||'')+' '+a.href)&&/^https?:/.test(a.href));
 const conditions=lines.filter(l=>/本人確認|顔写真|身分証|CLOUD PASS|おひとり様|代理|配送|来店|受取|住所|応募/.test(l)&&l.length>=8&&l.length<=280).slice(0,22);
 const articleId=new URL(url).pathname.match(/(\d+)\.html$/)?.[1];if(!articleId)throw new Error('記事ID未取得');
 return {
  id:'shibuya-tsutaya:'+articleId,sourceId:'shibuya-tsutaya',title,sourceName:'SHIBUYA TSUTAYA',sourceUrl:url,fetchedAt,publishedDate:null,
  entryPeriod:entry,resultAnnouncement:result,purchasePeriod:purchase,
  applicationMethod:'CLOUD PASS等の公式申込ページからWeb応募',webApplicationUrl:apply?.href??null,webApplicationLabel:apply?'公式の申込ページ':'公式記事から申込先を確認',
  applicationNote:'当選後はSHIBUYA TSUTAYAで本人確認のうえ購入・受取。申込時の本人情報と確認書類を一致させてください。',
  receivingMethod:'STORE_ONLY',receivingLabel:'SHIBUYA TSUTAYA店頭受取',storeSelectionNote:'POKÉMON CARD LOUNGE（SHIBUYA TSUTAYA 5F）で受取',
  resultNote:result?'公式記事記載の当選発表':'当選発表日時は公式記事で確認',
  stores:[{brand:'SHIBUYA TSUTAYA',name:'POKÉMON CARD LOUNGE',address:null,prefecture:'東京都',sourceUrl:'https://shibuyatsutaya.tsite.jp/pokemoncardlounge/'}],
  prices:[],conditions:[...new Set(conditions)],handoverRestrictions:lines.filter(l=>/代理.*不可|配送.*行っておりません|本人.*以外/.test(l)),
  unknowns:[...(result?[]:['当選発表日時']),...(purchase?[]:['受取期間']),'あなたの応募状況・当選状況'],
  evidence:{entry:entry.raw,result:result?.raw??null,purchase:purchase?.raw??null},
  verification:'SHIBUYA TSUTAYA公式EVENT一覧と個別記事を通常HTTPで独立2回取得し、抽出値を照合'
 };
}
export async function collect(fetcher){
 const ledger=[];
 async function raw(url){const r=await fetcher(url);const{body,...record}=r;ledger.push(record);if(!r.ok)throw new Error(r.error??('HTTP '+r.status));return decodeBody(body,r.headers['content-type']).text;}
 try{
  const robots=await raw('https://shibuyatsutaya.tsite.jp/robots.txt');
  const rules=parseRobots(robots,'PokemonRadar');
  async function allowed(url){const u=new URL(url);if(u.origin!=='https://shibuyatsutaya.tsite.jp')throw new Error('許可外ホスト');if(!isPathAllowed(rules,u.pathname+u.search))throw new Error('robotsで禁止されたURL');return raw(url);}
  const list=await allowed(ENTRY),candidates=discover(list);
  if(!candidates.length)throw new Error('SHIBUYA TSUTAYA公式EVENTからポケカ抽選記事を発見できません。0件とは扱いません');
  const cases=[],rejected=[];
  for(const c of candidates){try{cases.push(extractCase(await allowed(c.url),c.url,new Date().toISOString()));}catch(e){rejected.push({url:c.url,title:c.title,reason:e.message});}}
  if(!cases.length)throw new Error('SHIBUYA TSUTAYA抽選案件を確定できません');
  return {ok:true,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),coverage:'SHIBUYA TSUTAYA公式ポケカEVENT一覧から最新の抽選販売記事を最大5件確認',cases,rejected,ledger};
 }catch(e){return {ok:false,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),error:e.message,cases:null,ledger};}
}
const norm=r=>JSON.stringify(r.cases.map(({fetchedAt,...c})=>c).sort((a,b)=>a.id.localeCompare(b.id)));
export function merge(previous,a,b){
 if(!a.ok||!b.ok||a.mode!=='LIVE'||b.mode!=='LIVE'||a.pid===b.pid||!a.cases?.length||norm(a)!==norm(b))throw new Error('独立2回の実取得・抽出照合が不成立。前回保持');
 const ids=new Set(b.cases.map(c=>c.id));
 const kept=previous.cases.filter(c=>!ids.has(c.id)).map(c=>c.sourceId==='shibuya-tsutaya'?{...c,retainedFromPrevious:true}:c);
 return {...previous,cases:[...kept,...b.cases],sources:{...(previous.sources??{}),'shibuya-tsutaya':{name:'SHIBUYA TSUTAYA',fetchedAt:b.finishedAt,coverage:b.coverage,verifiedCases:b.cases.length,evidence:[a,b].map(r=>({pid:r.pid,requests:r.ledger.map(e=>({url:e.requestedUrl,status:e.status,bytes:e.bytes,sha256:e.sha256}))}))}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,target]=process.argv.slice(2);
 if(action==='run'){const r=await collect(createHttpsFetcher({allowedHosts:['shibuyatsutaya.tsite.jp'],maxBytes:4*1024*1024,userAgent:'PokemonRadar/0.1 (+public lottery information check)'}));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(r,null,2)+'\n');process.exitCode=r.ok?0:10;}
 else if(action==='all'){fs.mkdirSync(target,{recursive:true});for(let i=1;i<=2;i++){const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'run',path.join(target,'run-'+i+'.json')],{stdio:'inherit'});if(r.status!==0){process.exitCode=r.status??99;break;}if(i===1)await new Promise(r=>setTimeout(r,15000));}}
 else if(action==='adopt'){const file=process.argv[4],read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const next=merge(read(file),read(path.join(target,'run-1.json')),read(path.join(target,'run-2.json')));fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(file+'.tmp',file);console.log('SHIBUYA TSUTAYA '+next.sources['shibuya-tsutaya'].verifiedCases+'件を照合・追加');}
 else throw new Error('run/all/adopt');
}
