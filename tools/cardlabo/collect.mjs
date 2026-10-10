import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHttpsFetcher,parseRobots,isPathAllowed} from '../otakara-dryrun/core/http.mjs';
import {extractAnchors,extractTitles,htmlToText,pickArticleScope,decodeBody} from '../otakara-dryrun/core/htmlText.mjs';
import {parsePeriodAfterLabel} from '../otakara-dryrun/core/dates.mjs';

export const ENTRY='https://www.c-labo.jp/tcg/pokemon/';
export function discover(html){
 const candidates=[],excluded=[];
 for(const a of extractAnchors(html)){
  const u=new URL(a.href,ENTRY);
  if(u.origin!=='https://www.c-labo.jp'||!/^\/shop\/[^/]+\/blog\/\d+\/$/.test(u.pathname))continue;
  if(!/ポケモン|ポケカ/.test(a.text)||!/抽選/.test(a.text)||/買取|大会|当選発表|結果発表/.test(a.text)){excluded.push({url:u.href,title:a.text,reason:'個別のポケカ抽選案内タイトルではない'});continue;}
  if(!candidates.some(x=>x.url===u.href))candidates.push({url:u.href,title:a.text});
 }
 // 情報源全体の網羅とは扱わない。公式ポケモン欄に掲載された最新3記事のみ。
 return {candidates:candidates.slice(0,3),excluded,notVisited:candidates.slice(3)};
}
export function extractCase(html,url,shopHtml,fetchedAt){
 if(!/^https:\/\/www\.c-labo\.jp\/shop\/[^/]+\/blog\/\d+\/$/.test(url))throw new Error('個別記事URLではありません');
 const scope=pickArticleScope(html);if(scope.scope!=='article')throw new Error('記事本文を特定できません');
 const text=htmlToText(scope.html),title=extractTitles(scope.html).h1;
 if(!title||!/ポケモン|ポケカ/.test(title)||!/抽選/.test(title)||/買取|大会|結果発表/.test(title))throw new Error('対象記事ではありません');
 const lines=text.split('\n');
 function period(label,single=false){
  const i=lines.findIndex(l=>label.test(l));if(i<0)throw new Error('必須の日程ラベル未取得');
  const joined=lines[i]+(/\d{4}/.test(lines[i])?'':lines[i+1]??'');
  const p=parsePeriodAfterLabel(joined,label.source);
  if(!p.start?.date||(!single&&!p.end?.date)||p.start.reason||p.end?.reason)throw new Error('日程を確定できません');
  return {...p,end:p.end??p.start};
 }
 const entry=period(/応募期間\s*[:：]?/),result=period(/当選発表\s*[:：]?/,true),purchase=period(/(?:当選者(?:店頭|の)?購入(?:可能)?期間|購入期間)\s*[:：]?/);
 if(!entry.end?.date||!purchase.end?.date)throw new Error('期間の終端未取得');
 if(entry.start.date>entry.end.date||purchase.start.date>purchase.end.date)throw new Error('期間の順序が不正');
 const application=lines.filter(l=>/フォロー|リポスト/.test(l)&&!/アカウントID/.test(l));
 if(!application.some(l=>/フォロー/.test(l))||!application.some(l=>/リポスト/.test(l)))throw new Error('応募方法未確認');
 const receiving=lines.filter(l=>/店頭/.test(l)&&/購入|ご購入|受取/.test(l)&&!/一般販売/.test(l));
 if(!receiving.length)throw new Error('店頭受取条件未確認');
 const sm=shopHtml.match(/<th\b[^>]*>\s*所在地\s*<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i),address=sm?htmlToText(sm[1]):null;
 const name=htmlToText(shopHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??'').replace(/^カードラボ\s*/,'').replaceAll('\n',' ');
 const prefecture=address?.match(/(北海道|東京都|京都府|大阪府|[一-龥]{2,3}県)/)?.[1];
 if(!address||!prefecture||!name)throw new Error('公式店舗の所在地未取得');
 const shopPath=new URL(url).pathname.match(/^\/shop\/([^/]+)\//)[1];
 const twitter=extractAnchors(shopHtml).find(a=>/^https:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/?]+\/?$/.test(a.href)&&/Twitter/.test(a.text||htmlToText(a.rawInner)));
 const warnings=[];for(const p of[entry,result,purchase])for(const d of[p.start,p.end])if(d?.weekdayMatches===false)warnings.push('原文の日付と曜日が不一致: '+d.raw+'（数字を保持。公式案内を要確認）');
 const conditions=lines.filter(l=>/本人|代理|アカウント|無効|キャンセル|身分|本人様確認|DM.*確認/.test(l)&&l.length>8);
 return {id:'cardlabo:'+new URL(url).pathname,sourceId:'cardlabo',title,sourceName:'カードラボ '+name,sourceUrl:url,fetchedAt,
 publishedDate:text.match(/\b(20\d{2})\.(\d{2})\.(\d{2})\b/)?.[0]?.replaceAll('.','-')??null,
 entryPeriod:entry,resultAnnouncement:result,purchasePeriod:purchase,
 applicationMethod:'Xのフォロー・対象ポストのリポスト',webApplicationUrl:null,webApplicationLabel:'対象ポストのURLは未確認。公式案内・店舗Xで確認',applicationNote:'応募は対象ポストで行います。この案内ページだけでは応募完了になりません。',
 receivingMethod:'STORE_ONLY',receivingLabel:'店頭受取・来店必須',storeSelectionNote:'この店舗で購入・受取が必要',resultNote:'当選者へのXのDM。本人のアカウントで確認',
 stores:[{brand:'カードラボ',name,address,prefecture,sourceUrl:'https://www.c-labo.jp/shop/'+shopPath+'/',officialAccount:twitter?.href??null}],
 conditions:[...new Set([...warnings,...conditions])],handoverRestrictions:lines.filter(l=>/パックのみ|外箱|シュリンク|バラパック/.test(l)),prices:[],
 unknowns:[...(entry.end.timeUnconfirmed?['応募締切の時刻']:[]),'対象の応募ポストURL','あなたの応募資格・当選状況'],
 evidence:{entry:entry.raw,result:result.raw,purchase:purchase.raw,receiving},verification:'公式記事・公式店舗を独立2回取得し、抽出値を照合済み'};
}
export async function collect(fetcher){
 const ledger=[];
 async function get(url){const r=await fetcher(url);const{body,...record}=r;ledger.push(record);if(!r.ok)throw new Error(r.error??'取得失敗');return decodeBody(body,r.headers['content-type']).text;}
 const robots=await get('https://www.c-labo.jp/robots.txt');
 const rules=parseRobots(robots,'PokemonRadar');
 async function allowed(url){if(!isPathAllowed(rules,new URL(url).pathname))throw new Error('robotsで禁止されたURL');return get(url);}
 try{
  const d=discover(await allowed(ENTRY));if(!d.candidates.length)throw new Error('対象記事が0件。前回データは置換しません');
  const cases=[];
  for(const c of d.candidates){const html=await allowed(c.url);const store='https://www.c-labo.jp'+new URL(c.url).pathname.match(/^\/shop\/[^/]+\//)[0];const sh=await allowed(store);cases.push(extractCase(html,c.url,sh,new Date().toISOString()));}
  return {ok:true,mode:'LIVE',pid:process.pid,finishedAt:new Date().toISOString(),coverage:'公式ポケモン一覧に掲載された最新3抽選記事。全店舗・全記事の網羅ではありません',cases,ledger,excluded:d.excluded,notVisited:d.notVisited};
 }catch(e){return {ok:false,mode:'LIVE',pid:process.pid,error:e.message,ledger,cases:null};}
}
export function merge(previous,a,b){
 const norm=r=>JSON.stringify(r.cases.map(({fetchedAt,...c})=>c).sort((x,y)=>x.id.localeCompare(y.id)));
 if(!a.ok||!b.ok||a.mode!=='LIVE'||b.mode!=='LIVE'||a.pid===b.pid||!a.cases?.length||norm(a)!==norm(b))throw new Error('独立2回の実取得・抽出照合が不成立。前回保持');
 if(previous.schemaVersion!==1||!Array.isArray(previous.cases))throw new Error('前回形式不正');
 const ids=new Set(b.cases.map(c=>c.id));
 const kept=previous.cases.filter(c=>!ids.has(c.id)).map(c=>c.sourceId==='cardlabo'?{...c,retainedFromPrevious:true}:c);
 return {...previous,cases:[...kept,...b.cases],sources:{...(previous.sources??{}),cardlabo:{name:'カードラボ',fetchedAt:b.finishedAt,coverage:b.coverage,verifiedCases:b.cases.length,evidence:[a,b].map(r=>({pid:r.pid,requests:r.ledger.map(e=>({url:e.requestedUrl,status:e.status,bytes:e.bytes,sha256:e.sha256,contentType:e.headers?.['content-type']}))}))}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,target]=process.argv.slice(2);
 if(action==='run'){
  let r;try{r=await collect(createHttpsFetcher({allowedHosts:['www.c-labo.jp'],userAgent:'PokemonRadar/0.1 (+public lottery information check)'}));}catch(e){r={ok:false,mode:'LIVE',pid:process.pid,error:e.message,cases:null};}
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(r,null,2)+'\n');process.exitCode=r.ok?0:10;
 }else if(action==='all'){
  fs.mkdirSync(target,{recursive:true});
  for(let i=1;i<=2;i++){const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'run',path.join(target,'run-'+i+'.json')],{stdio:'inherit'});if(r.status!==0){process.exitCode=r.status??99;break;}if(i===1)await new Promise(r=>setTimeout(r,20000));}
 }else if(action==='adopt'){
  const file=process.argv[4],read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
  const next=merge(read(file),read(path.join(target,'run-1.json')),read(path.join(target,'run-2.json')));
  fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(file+'.tmp',file);console.log('カードラボ '+next.sources.cardlabo.verifiedCases+'件を照合・追加');
 }else throw new Error('run/all/adopt');
}
