import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createHttpsFetcher,parseRobots,isPathAllowed} from '../otakara-dryrun/core/http.mjs';
import {extractAnchors,extractTitles,htmlToText,pickArticleScope,decodeBody} from '../otakara-dryrun/core/htmlText.mjs';
import {findDateTimes,resolveDateTime} from '../otakara-dryrun/core/dates.mjs';

export const ENTRY='https://www.furu1.net/';
export const ENTRYPOINTS=[
  'https://www.furu1.net/',
  'https://www.furu1.net/news.html?media=pc',
  'https://www.furu1.net/news/news_information.html',
];
export const MAX_ARTICLES=5;

function near(lines,labelRe,count=10){
  const i=lines.findIndex(l=>labelRe.test(l));
  return i<0?null:lines.slice(i,i+count).join(' ');
}
function range(seg,label){
  if(!seg)return null;
  const dts=findDateTimes(seg);
  if(dts.length<2)return null;
  const start=resolveDateTime(dts[0]);
  let year=start.date?Number(start.date.slice(0,4)):dts[0].year;
  const end=resolveDateTime(dts[dts.length-1],year);
  if(!start.date||!end.date||start.reason||end.reason)return null;
  return {found:true,raw:seg,start,end,deadlineOnly:false,status:(start.inferredYear||end.inferredYear)?'INFERRED':'CONFIRMED',notes:[...(start.notes||[]),...(end.notes||[]),label]};
}
function single(seg){
  if(!seg)return null;
  const dt=findDateTimes(seg)[0]; if(!dt)return null;
  const start=resolveDateTime(dt);
  if(!start.date||start.reason)return null;
  return {found:true,raw:seg,start,end:null,deadlineOnly:false,single:true,approximate:/頃|まで|以降|順次/.test(seg),status:start.inferredYear?'INFERRED':'CONFIRMED',notes:start.notes||[]};
}
function articleId(url){
  const u=new URL(url);
  return u.pathname.replace(/^\/news\//,'').replace(/\/$/,'').replaceAll('/','-');
}
export function discover(html,base=ENTRY){
  const out=[];
  for(const a of extractAnchors(html)){
    let u;try{u=new URL(a.href,base);}catch{continue;}
    if(!/^https:\/\/(?:www\.)?furu1\.net$/.test(u.origin)||!u.pathname.startsWith('/news/'))continue;
    const label=(a.text||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!/ポケモンカードゲーム|ポケモンカード/.test(label))continue;
    if(!/抽選受付|抽選販売|抽選/.test(label))continue;
    if(/中止|取消|当選発表のみ|結果/.test(label))continue;
    u.search='';u.hash='';
    if(!out.some(x=>x.url===u.href))out.push({url:u.href,title:label});
  }
  return out.slice(0,MAX_ARTICLES);
}

function stableTitleId(title){
  return createHash('sha256').update(title.normalize('NFKC')).digest('hex').slice(0,16);
}
export function discoverStrongListings(html,sourceUrl=ENTRY){
  const out=[];
  for(const raw of htmlToText(html).split('\n')){
    const line=raw.normalize('NFKC').replace(/\s+/g,' ').trim();
    const i=line.indexOf('ポケモンカード');
    if(i<0)continue;
    const title=line.slice(i).replace(/\s+NEW\s*$/i,'').trim();
    if(!/ポケモンカードゲーム|ポケモンカード/.test(title))continue;
    if(!/抽選受付|抽選販売|抽選/.test(title))continue;
    if(/中止|取消|当選発表のみ|結果/.test(title))continue;
    const dm=line.match(/(20\d{2})[/.](\d{1,2})[/.](\d{1,2})/);
    const publishedDate=dm?dm[1]+'-'+String(dm[2]).padStart(2,'0')+'-'+String(dm[3]).padStart(2,'0'):null;
    if(!out.some(x=>x.title===title))out.push({title,sourceUrl,publishedDate});
  }
  return out.slice(0,MAX_ARTICLES);
}
function listingOnlyCase(item,fetchedAt){
  return {
    id:'furuichi:list:'+stableTitleId(item.title),
    sourceId:'furuichi',
    title:item.title,
    sourceName:'ふるいち／古本市場',
    sourceUrl:item.sourceUrl,
    fetchedAt,
    publishedDate:item.publishedDate,
    entryPeriod:{raw:'公式一覧では応募期間未確認',start:null,end:null,deadlineOnly:false,status:'UNCONFIRMED',notes:['公式一覧で抽選受付記事を確認。詳細日程は未確認']},
    resultAnnouncement:null,
    purchasePeriod:null,
    applicationMethod:'公式お知らせで抽選受付を確認',
    webApplicationUrl:null,
    webApplicationLabel:'ふるいち公式のお知らせ一覧で詳細を確認',
    applicationNote:'公式一覧で抽選受付記事を確認しています。応募方法・締切・受取方法は公式案内で確認してください。',
    receivingMethod:'UNKNOWN',
    receivingLabel:'未確認',
    storeSelectionNote:'公式案内で確認',
    resultNote:'当選発表日時は未確認',
    stores:[],
    prices:[],
    conditions:['ふるいち公式一覧でポケモンカードの抽選受付記事を確認'],
    handoverRestrictions:[],
    unknowns:['応募期間','応募方法','当選発表日時','購入・受取期間','受取方法','あなたの応募資格・応募状況'],
    evidence:{entry:'公式一覧で抽選受付記事を確認',result:null,purchase:null},
    verification:'ふるいち公式一覧を独立2回取得し、同一の抽選受付タイトルを確認'
  };
}
export function extractCase(html,url,fetchedAt){
  const scope=pickArticleScope(html);
  const body=scope.html||html;
  const text=htmlToText(body);
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  const title=(extractTitles(body).h1||extractTitles(html).h1||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  if(!/ポケモンカードゲーム|ポケモンカード/.test(title)||!/抽選受付|抽選販売|抽選/.test(title))throw new Error('ふるいちのポケカ抽選記事ではありません');
  if(/中止|取消/.test(title))throw new Error('中止・取消記事は案件化しません');

  const entry=range(near(lines,/抽選受付日時|応募受付期間|応募期間|抽選受付期間/),'ふるいち公式の応募期間');
  if(!entry?.end?.date)throw new Error('応募期間を確定できません');
  const result=single(near(lines,/当選発表/));
  const purchase=range(near(lines,/当選商品販売時間|販売期間|購入期間|受取期間/),'ふるいち公式の購入・受取期間');

  const anchors=extractAnchors(body);
  const apply=anchors.find(a=>/LivePocket|Googleフォーム|応募|抽選受付/.test((a.text||'')+' '+a.href)&&/^https?:/.test(a.href));
  const conditions=lines.filter(l=>/ふるいちアプリ|本人確認|本人のみ|代理人|重複|Googleアカウント|LivePocket|来店|抽選QR|応募|購入/.test(l)&&l.length>=8&&l.length<=280).slice(0,24);
  const storeLine=lines.find(l=>/店$|店にて|店舗/.test(l)&&/ふるいち|古本市場|トップブックス/.test(l));
  const id='furuichi:'+articleId(url);

  return {
    id,sourceId:'furuichi',title,sourceName:'ふるいち／古本市場',sourceUrl:url,fetchedAt,publishedDate:null,
    entryPeriod:entry,resultAnnouncement:result,purchasePeriod:purchase,
    applicationMethod:apply&&/livepocket/i.test(apply.href)?'LivePocket抽選':'公式案内記載の抽選受付',
    webApplicationUrl:apply?.href??null,webApplicationLabel:apply?'公式の抽選受付ページ':'公式記事で応募方法を確認',
    applicationNote:'記事により店頭QR・LivePocket・Googleフォーム等の受付方式が異なります。必ず公式案内を確認してください。',
    receivingMethod:'STORE_ONLY',receivingLabel:'店頭購入・受取',storeSelectionNote:storeLine||'対象店舗への来店が必要',
    resultNote:result?'公式案内記載の当選発表':'当選発表日時は公式案内で確認',
    stores:[],prices:[],conditions:[...new Set(conditions)],handoverRestrictions:lines.filter(l=>/シュリンク開封|外箱処分|代理人.*不可|権利.*譲渡/.test(l)),
    unknowns:[...(result?[]:['当選発表日時']),...(purchase?[]:['購入・受取期間']),'あなたの応募資格・応募状況'],
    evidence:{entry:entry.raw,result:result?.raw??null,purchase:purchase?.raw??null},
    verification:'ふるいち公式ニュース一覧と個別記事を通常HTTPで独立2回取得し、抽出値を照合'
  };
}
export async function collect(fetcher){
  const ledger=[];
  async function request(url){
    const r=await fetcher(url);
    const {body,...record}=r;
    ledger.push(record);
    return {r,body};
  }
  async function raw(url){
    const {r,body}=await request(url);
    if(!r.ok)throw new Error(r.error??('HTTP '+r.status));
    return decodeBody(body,r.headers['content-type']).text;
  }
  try{
    // robots.txt が無い(404)サイトは標準仕様上「禁止規則なし」として扱う。
    // 403/429/5xx 等は取得失敗として安全停止する。
    const robotsResult=await request('https://www.furu1.net/robots.txt');
    let rules;
    if(robotsResult.r.ok){
      rules=parseRobots(decodeBody(robotsResult.body,robotsResult.r.headers['content-type']).text,'PokemonRadar');
    }else if(robotsResult.r.status===404){
      rules=parseRobots('','PokemonRadar');
    }else{
      throw new Error(robotsResult.r.error??('robots HTTP '+robotsResult.r.status));
    }

    async function allowed(url){
      const u=new URL(url);
      if(!/^(?:www\.)?furu1\.net$/.test(u.hostname))throw new Error('許可外ホスト');
      if(!isPathAllowed(rules,u.pathname+u.search))throw new Error('robotsで禁止されたURL');
      return raw(url);
    }

    const discovered=[],strongListings=[],entryErrors=[];
    for(const entry of ENTRYPOINTS){
      try{
        const html=await allowed(entry);
        for(const c of discover(html,entry)){
          if(!discovered.some(x=>x.url===c.url))discovered.push(c);
        }
        for(const c of discoverStrongListings(html,entry)){
          if(!strongListings.some(x=>x.title===c.title))strongListings.push(c);
        }
      }catch(e){
        entryErrors.push({url:entry,reason:e.message});
      }
    }

    const candidates=discovered.slice(0,MAX_ARTICLES);
    const cases=[],rejected=[];
    for(const c of candidates){
      try{cases.push(extractCase(await allowed(c.url),c.url,new Date().toISOString()));}
      catch(e){rejected.push({url:c.url,title:c.title,reason:e.message});}
    }

    const knownTitles=new Set(cases.map(c=>c.title.normalize('NFKC').replace(/\s+/g,'')));
    for(const item of strongListings){
      const key=item.title.normalize('NFKC').replace(/\s+/g,'');
      if(!knownTitles.has(key)){
        cases.push(listingOnlyCase(item,new Date().toISOString()));
        knownTitles.add(key);
      }
    }

    if(!cases.length)throw new Error('ふるいち公式3入口からポケカ抽選案件を確認できません。0件とは扱いません');

    return {
      ok:true,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),
      coverage:'ふるいち公式トップ・新着一覧・お知らせ一覧の3入口から最新ポケカ抽選を確認。詳細URL取得時は日程まで解析し、一覧タイトルのみ確認できた場合は期間未確認として保持',
      cases,rejected,entryErrors,ledger
    };
  }catch(e){
    return {ok:false,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),error:e.message,cases:null,ledger};
  }
}
const norm=r=>JSON.stringify(r.cases.map(({fetchedAt,...c})=>c).sort((a,b)=>a.id.localeCompare(b.id)));
export function merge(previous,a,b){
  if(!a.ok||!b.ok||a.mode!=='LIVE'||b.mode!=='LIVE'||a.pid===b.pid||!a.cases?.length||norm(a)!==norm(b))throw new Error('独立2回の実取得・抽出照合が不成立。前回保持');
  const ids=new Set(b.cases.map(c=>c.id));
  const kept=previous.cases.filter(c=>!ids.has(c.id)).map(c=>c.sourceId==='furuichi'?{...c,retainedFromPrevious:true}:c);
  return {...previous,cases:[...kept,...b.cases],sources:{...(previous.sources??{}),furuichi:{name:'ふるいち／古本市場',fetchedAt:b.finishedAt,coverage:b.coverage,verifiedCases:b.cases.length,evidence:[a,b].map(r=>({pid:r.pid,requests:r.ledger.map(e=>({url:e.requestedUrl,status:e.status,bytes:e.bytes,sha256:e.sha256}))}))}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action,target]=process.argv.slice(2);
  if(action==='run'){
    const r=await collect(createHttpsFetcher({allowedHosts:['www.furu1.net','furu1.net'],maxBytes:4*1024*1024,userAgent:'PokemonRadar/0.1 (+public lottery information check)'}));
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(r,null,2)+'\n');process.exitCode=r.ok?0:10;
  }else if(action==='all'){
    fs.mkdirSync(target,{recursive:true});
    for(let i=1;i<=2;i++){const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'run',path.join(target,'run-'+i+'.json')],{stdio:'inherit'});if(r.status!==0){process.exitCode=r.status??99;break;}if(i===1)await new Promise(r=>setTimeout(r,15000));}
  }else if(action==='adopt'){
    const file=process.argv[4],read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
    const next=merge(read(file),read(path.join(target,'run-1.json')),read(path.join(target,'run-2.json')));
    fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(file+'.tmp',file);
    console.log('ふるいち '+next.sources.furuichi.verifiedCases+'件を照合・追加');
  }else throw new Error('run/all/adopt');
}
