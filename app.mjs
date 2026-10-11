import {PersonalStore,personalMatches,favoriteCases} from './personal.mjs?v=0113';
import {AmazonPersonal,readCaptureHash} from './amazon-personal.mjs?v=0114';
import {entryState,matches,safeUrl,deadlineDisplay} from './model.mjs?v=0112';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=d=>d?d.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1/$2/$3'):'未確認';
const time=iso=>iso?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)):'未確認';
const period=p=>p?.start?(p.start.iso?time(p.start.iso):date(p.start.date))+(p.end?' 〜 '+(p.end.iso?time(p.end.iso):date(p.end.date)):''):'未確認';
const row=(label,value,note='')=>`<div class="row"><dt>${esc(label)}</dt><dd>${esc(value)}${note?`<small>${esc(note)}</small>`:''}</dd></div>`;
let snapshot=null, showEvidence=false;
const shareSelected=new Set();
let currentCasesById=new Map();
const cloud=document.documentElement.dataset.cloudSync==='true';
let storage;try{storage=localStorage;}catch{}
const personal=new PersonalStore({cloud,storage,onChange:()=>{updatePersonalStatus();render();}});
const amazon=new AmazonPersonal({cloud,onChange:message=>{$('amazon-share-status').textContent=message||'PCの確認結果を共有しています';render();}});
if(cloud){
 try{
  const capture=readCaptureHash(location.hash);
  if(capture){
   $('amazon-import-panel').hidden=false;
   $('amazon-import-title').textContent=String(capture.title??'商品名未確認');
   $('amazon-import-save').onclick=async()=>{
    $('amazon-import-save').disabled=true;$('amazon-import-status').textContent='保存しています…';
    try{await amazon.save(capture);history.replaceState(null,'',location.pathname+location.search);$('amazon-import-status').textContent='保存しました。スマホでも同じ個人用画面で見られます。';$('amazon-import-save').hidden=true;}
    catch(e){$('amazon-import-status').textContent=e.message;$('amazon-import-save').disabled=false;}
   };
  }
 }catch(e){$('amazon-import-panel').hidden=false;$('amazon-import-status').textContent='送信内容を読めませんでした。PCで確認し直してください。';$('amazon-import-save').hidden=true;}
}
function updatePersonalStatus(){
 $('sync-status').textContent=personal.message;
 $('sync-link').hidden=cloud;$('retry-sync').hidden=!cloud;
 $('sync-help').textContent=cloud?'同じChatGPTアカウントでこの個人用URLを開くと、PC・スマホで記録を共有できます。応募手続きは公式アプリ等で行ってください。':'この画面は端末内保存です。端末間で共有する場合は個人用画面をお使いください。こちらの記録は自動移行されません。';
}
updatePersonalStatus();
$('retry-sync').onclick=()=>personal.sync();
 $('unapplied-only').onchange=render;
 $('amazon-only').onchange=render;
function handlePersonalClick(e){
 const button=e.target.closest('button[data-personal]');if(!button)return;
 const article=button.closest('[data-id]');personal.toggle(article.dataset.id,button.dataset.personal);
 if(button.dataset.personal==='favorite'&&personal.get(article.dataset.id).favorite)$('favorites-panel').open=true;
}
$('cases').addEventListener('click',handlePersonalClick);
$('favorite-cases').addEventListener('click',handlePersonalClick);

function shareControl(c){
 const selected=shareSelected.has(c.id);
 return `<label class="case-select" aria-label="案件を選択"><input type="checkbox" data-share-case="${esc(c.id)}" ${selected?'checked':''}><span class="case-select-box" aria-hidden="true"></span></label>`;
}
function handleShareSelect(e){
 const input=e.target.closest('input[data-share-case]');if(!input)return;
 const id=input.dataset.shareCase;
 if(input.checked)shareSelected.add(id);else shareSelected.delete(id);
 render();
}
$('cases').addEventListener('change',handleShareSelect);
$('favorite-cases').addEventListener('change',handleShareSelect);

function updateSharePanel(){
 const count=shareSelected.size;
 $('share-count').textContent=String(count);
 $('share-panel').hidden=count===0;
 $('share-selected').disabled=count===0;
 document.documentElement.dataset.caseSelectionActive=String(count>0);
}
function shareCaseText(c,index){
 const amazon=c.sourceId==='official-amazon-jp';
 const seller=amazon?'Amazon':(c.sourceName||'販売先未確認');
 let deadline='未確認';
 if(!amazon){
  try{deadline=deadlineDisplay(c,Date.now()).dateLabel||'未確認';}catch{}
 }
 const url=safeUrl(c.sourceUrl);
 return [`${index}. ${c.title||'商品名未確認'}`,`販売先：${seller}`,`締切：${deadline}`,url?`応募・確認：${url}`:null].filter(Boolean).join('\n');
}
function buildShareText(){
 const cases=[...shareSelected].map(id=>currentCasesById.get(id)).filter(Boolean);
 return ['【ポケモン抽選・招待情報】','',...cases.map((c,i)=>shareCaseText(c,i+1))].join('\n\n');
}
$('share-clear').onclick=()=>{shareSelected.clear();render();};
$('share-selected').onclick=async()=>{
 const text=buildShareText();
 if(!text||shareSelected.size===0)return;
 $('share-status').textContent='共有を準備しています…';
 try{
  if(navigator.share){
   await navigator.share({title:'ポケモン抽選・招待情報',text});
   $('share-status').textContent='共有しました。';
  }else{
   await navigator.clipboard.writeText(text);
   $('share-status').textContent='共有文をコピーしました。LINEなどへ貼り付けて送れます。';
  }
 }catch(e){
  if(e?.name==='AbortError'){$('share-status').textContent='共有をキャンセルしました。';return;}
  try{await navigator.clipboard.writeText(text);$('share-status').textContent='共有文をコピーしました。LINEなどへ貼り付けて送れます。';}
  catch{$('share-status').textContent='共有できませんでした。案件を減らして再度お試しください。';}
 }
};
try{showEvidence=localStorage.getItem('radar:hide-details')!==null?localStorage.getItem('radar:hide-details')==='false':localStorage.getItem('radar:show-evidence')==='true';}catch{}
function applyDetailVisibility(){
 document.documentElement.dataset.hideDetails=String(!showEvidence);
 $('hide-details').checked=!showEvidence;
 document.querySelectorAll('.evidence').forEach(n=>n.hidden=!showEvidence);
}
applyDetailVisibility();
$('settings').onclick=()=>{const open=$('settings-panel').hidden;$('settings-panel').hidden=!open;$('settings').setAttribute('aria-expanded',String(open));};
$('hide-details').onchange=()=>{showEvidence=!$('hide-details').checked;try{localStorage.setItem('radar:hide-details',String(!showEvidence));}catch{}applyDetailVisibility();};
const receivingControls=[...document.querySelectorAll('input[name="receiving"]')];
const receivingLabels={delivery:'配送・郵送',store:'店頭受取',unknown:'未確認'};
try{
 const saved=JSON.parse(localStorage.getItem('radar:receiving-filter')||'[]');
 if(Array.isArray(saved))receivingControls.forEach(n=>n.checked=saved.includes(n.value));
}catch{}
const selectedReceiving=()=>receivingControls.filter(n=>n.checked).map(n=>n.value);
function receivingChanged(){
 try{localStorage.setItem('radar:receiving-filter',JSON.stringify(selectedReceiving()));}catch{}
 render();
}
receivingControls.forEach(n=>n.addEventListener('change',receivingChanged));
$('clear-receiving').addEventListener('click',()=>{receivingControls.forEach(n=>n.checked=false);receivingChanged();});
function card(c,now) {
  if(c.browserCapture)return amazonCard(c,now);
  const record=personal.get(c.id);
  const state=entryState(c,now), labels={before:'応募開始前',open:'受付中',soon:'締切間近',closed:'応募締切済み',unknown:'応募期間未確認'};
  const deadline=deadlineDisplay(c,now);
  const brandMap={};for(const s of c.stores)(brandMap[s.brand]??=[]).push(s.name);
  const groups=Object.entries(brandMap).map(([brand,names])=>`<h4 class="store-brand">${esc(brand)} · ${names.length}店舗</h4><div class="store-list">${names.map(n=>`<span class="store-chip">${esc(n)}</span>`).join('')}</div>`).join('');
  const result=(c.resultAnnouncement?.notAfter?period(c.resultAnnouncement)+' まで':period(c.resultAnnouncement))+(c.resultAnnouncement?.approximate?' 頃':'')+(c.resultAnnouncement?.notBefore?' 以降':'');
  const href=safeUrl(c.sourceUrl);
  return `<article class="card" data-id="${esc(c.id)}"><div class="card-body"><p class="card-source">${esc(c.sourceName)} · 抽選販売</p><div class="card-title">${shareControl(c)}<h3>${esc(c.title)}</h3><button type="button" class="favorite-button ${record.favorite?'selected':''}" data-personal="favorite" aria-pressed="${!!record.favorite}" aria-label="${record.favorite?'お気に入りを解除':'お気に入りに追加'}">${record.favorite?'★':'☆'}</button></div><div class="applied-control"><button type="button" data-personal="applied" class="applied-button ${record.applied?'selected':''}" aria-pressed="${!!record.applied}">${record.applied?'✓ 応募済み（タップで戻す）':'応募済みにする'}</button><span>${record.appliedAt?'記録：'+esc(time(record.appliedAt))+' JST':'未応募'}</span></div><div class="badges"><span class="badge ${state==='closed'?'gray':state==='soon'?'amber':''}">${labels[state]}</span><span class="badge">${esc(c.applicationMethod)}</span><span class="badge amber">${esc(c.receivingLabel)}</span></div><div class="deadline ${deadline.tone}"><small>応募締切 · 日本時間</small><strong>${esc(deadline.dateLabel)}</strong><p class="remaining">${esc(deadline.remainingLabel)}</p></div><dl>${row('応募期間',period(c.entryPeriod))}${row('当選通知',result,c.resultNote||'時刻未確認・公式アプリの応募履歴で確認')}${row('購入期間',period(c.purchasePeriod),c.purchasePeriod?.timeQualifier||(c.purchasePeriod?.end?.iso?'':'時刻未確認'))}${row('応募方法',c.applicationMethod,c.webApplicationLabel)}${row('受取方法',c.receivingLabel,c.storeSelectionNote||'応募時に選んだ店舗への来店が必要')}${c.receivingMethod==='DELIVERY'?row('発送予定',c.shippingPeriod?.start?period(c.shippingPeriod):(c.shippingPeriod?.raw||'未確認'),c.shippingPeriod?.start?'発送予定であり、到着日ではありません':'公式の表現をそのまま表示。正確な日付は推測していません'):row('受取店舗',c.sourceId==='cardlabo'?c.stores[0].name:`${c.stores.length}店舗から応募時に選択`,c.sourceId==='cardlabo'?c.stores[0].address:'所在地・営業時間は未確認。下の店舗一覧で店名を確認')}${row('価格',c.prices.map(p=>p.label).join(' / ')||'未確認')}</dl><div class="callout">${c.receivingMethod==='DELIVERY'?'配送先と応募条件':'受取店舗と応募条件'}をご確認ください。あなたが応募条件を満たすかは未確認です。</div><details class="conditions"><summary>応募・購入の条件を見る（${c.conditions.length+c.handoverRestrictions.length}項目）</summary><ul>${c.conditions.map(x=>`<li>${esc(x)}</li>`).join('')}${c.handoverRestrictions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>${c.receivingMethod==='DELIVERY'?'':`<details class="stores"><summary>受取店舗を見る（${c.stores.length}店舗）</summary><p class="muted">${esc(c.storeSelectionNote||'応募時に1店舗を選び、当選後は選択した店舗で購入します。掲載店舗すべてへの来店は不要です。')}</p>${groups}</details>`}${href?`<a class="card-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">公式の抽選案内を確認 ↗</a>`:''}<p class="link-note display-supplementary">${esc(c.applicationNote||'このリンクは案内ページです。応募は公式アプリ内で行います。')}</p><details><summary>未確認の項目</summary><ul>${c.unknowns.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details></div><div class="card-bottom">${c.retainedFromPrevious?'前回の確認情報を保持 · ' : ''}情報取得：${esc(time(c.fetchedAt))} JST <span class="display-supplementary">· ${esc(c.verification)}</span></div><div class="evidence" ${showEvidence?'':'hidden'}><details><summary>取得の根拠・補足</summary><p>掲載日：${esc(date(c.publishedDate))} / 取得：${esc(c.fetchedAt)}<br>通常HTTPで独立した2回の取得・抽出を照合。今回取得できた記事での確認です。</p><pre>${esc(c.sourceId==='pokemoncenter'?'日程は公式画像のOCR。年は案内の掲載年から補助（画像には年なし・曜日一致）。最新1記事のみの確認。\n\n':'')}${esc(c.evidence?.entry)}\n\n${esc(c.evidence?.result)}\n\n${esc(c.evidence?.purchase)}\n\n${esc((Array.isArray(c.evidence?.receiving)?c.evidence.receiving:[]).join('\n'))}</pre></details></div></article>`;
}
function amazonCard(c,now){
 const record=personal.get(c.id),stale=now-Date.parse(c.fetchedAt)>86400000;
 const href=safeUrl(c.sourceUrl),auto=!!c.automatedDiscovery;
 const sourceLabel=auto?'Amazon · 招待販売（CRAWL STORM Xで確認）':'Amazon · 招待販売（PCで確認）';
 const invitationState=c.invitationState||'REQUESTABLE';
 const invitationLabels={
  REQUESTABLE:'⚡ すぐ応募可能',
  REQUEST_SENT:'✓ Amazon側で応募済み確認',
  INVITED_ONLY_UNCONFIRMED:'招待販売 · 状態確認が必要',
  NONE:'招待受付表示なし'
 };
 const invitationLabel=invitationLabels[invitationState]||'招待状態未確認';
 const statusLabel=stale?'確認から24時間以上 · 再確認が必要':invitationLabel;
 const statusTone=invitationState==='REQUEST_SENT'?'':invitationState==='REQUESTABLE'?'amber':'gray';
 const sellerLabel=auto?'Amazon.co.jp（Chrome商品詳細で確認）':'Amazon.co.jp（PCで確認した時点）';
 const callout=auto?'CRAWL STORM Xが商品詳細ページで「招待をリクエスト」を確認しました。現在の受付状況はAmazonで最終確認してください。':'${esc(callout)}';
 const verifyText=auto?'CRAWL STORM XのChrome実ブラウザで商品詳細ページを確認した情報です。検索結果ページだけでは案件化していません。':'${esc(verifyText)}';
 const checkedLabel=auto?'Chrome確認':'PC確認';
 const observed=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(c.fetchedAt));
 return `<article class="card" data-id="${esc(c.id)}"><div class="card-body"><p class="card-source">${esc(sourceLabel)}</p><div class="card-title">${shareControl(c)}<h3>${esc(c.title)}</h3><button type="button" class="favorite-button ${record.favorite?'selected':''}" data-personal="favorite" aria-pressed="${!!record.favorite}" aria-label="${record.favorite?'お気に入りを解除':'お気に入りに追加'}">${record.favorite?'★':'☆'}</button></div><div class="applied-control"><button type="button" data-personal="applied" class="applied-button ${record.applied?'selected':''}" aria-pressed="${!!record.applied}">${record.applied?'✓ 応募済み（タップで戻す）':'応募済みにする'}</button><span>${record.appliedAt?'記録：'+esc(time(record.appliedAt))+' JST':'未応募'}</span></div><div class="badges"><span class="badge ${statusTone}">${esc(statusLabel)}</span><span class="badge gray">受取条件未確認</span></div><div class="deadline unknown"><small>応募締切</small><strong>未確認</strong><p class="remaining">締切までの残り時間は計算できません</p></div><dl>${row('Amazon状態',invitationLabel)}${row('応募方法','Amazonの招待リクエスト')}${row('販売元',sellerLabel)}${row('確認日時',observed+' JST')}${row('当選通知・購入期限','本人への案内を確認')}${row('受取方法','未確認')}</dl><div class="callout">保存時点の商品欄に招待リクエストの操作があった記録です。現在の受付状況と本人の応募可否はAmazonで確認してください。</div><details class="conditions"><summary>応募・購入の注意を見る</summary><p>この記録の保存では応募されません。Amazonで手続きした後に「応募済みにする」を押してください。リクエストの有効期間を応募締切とは扱いません。</p></details>${href?`<a class="card-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Amazonで招待をリクエスト・確認 ↗</a>`:''}<details class="display-supplementary"><summary>確認方法</summary><p>本人がPCのChromeで開いた商品欄を確認して保存した情報です。GitHubからの自動取得ではありません。定期再確認は行いません。</p></details></div><div class="card-bottom">${esc(checkedLabel)}：${esc(observed)} JST</div></article>`;
}
function renderCards(container,cases,now,empty){
 const opened=[...container.querySelectorAll('article details[open]')].map(d=>[d.closest('[data-id]').dataset.id,[...d.closest('article').querySelectorAll('details')].indexOf(d)]);
 const rendered=[];const failed=[];
 for(const c of cases){
  try{rendered.push(card(c,now));}
  catch(e){failed.push(c?.id??'unknown');console.error('POKEMON RADAR card render failed',c?.id,e);}
 }
 container.innerHTML=rendered.length?rendered.join('')+(failed.length?'<div class="empty"><strong>'+failed.length+'件は表示情報不足で保留しました</strong><p>他の案件は通常どおり表示しています。</p></div>':''):(cases.length?'<div class="empty"><strong>案件データの表示に失敗しました</strong><p>データ自体は取得済みです。再読み込みしてください。</p></div>':empty);
 for(const [id,index] of opened){const article=[...container.querySelectorAll('[data-id]')].find(a=>a.dataset.id===id);const d=article?.querySelectorAll('details')[index];if(d)d.open=true;}
}
function render(){
  if(!snapshot&&!amazon.cases.length)return;
  const now=Date.now(), filters={phase:$('phase').value,receiving:selectedReceiving(),store:$('store').value};
  const allCases=[...new Map([...amazon.cases,...(snapshot?.cases??[])].map(c=>[c.id,c])).values()];
  currentCasesById=new Map(allCases.map(c=>[c.id,c]));
  for(const id of [...shareSelected])if(!currentCasesById.has(id))shareSelected.delete(id);
  updateSharePanel();
  $('open-count').textContent=snapshot?snapshot.cases.filter(c=>['open','soon'].includes(entryState(c,now))).length:'未確認';
  $('soon-count').textContent=snapshot?snapshot.cases.filter(c=>entryState(c,now)==='soon').length:'未確認';
  const sources=[...new Set((snapshot?.cases??[]).map(c=>c.sourceId||'otakara'))];
  const names={otakara:'お宝創庫',cardlabo:'カードラボ',pokemoncenter:'ポケモンセンター',rakutenbooks:'楽天ブックス','official-amazon-jp':'Amazon'};
  $('source-count').textContent=sources.length+' / '+sources.map(x=>names[x]||x).join('・');
  const favorites=favoriteCases(allCases,personal.data.records);
  $('favorite-count').textContent=favorites.length;
  renderCards($('favorite-cases'),favorites,now,'<div class="empty"><strong>お気に入りはまだありません</strong><p>案件の☆を押すと、ここにまとめて表示されます。</p></div>');
  const pf={unapplied:$('unapplied-only').checked};
  const amazonOnly=$('amazon-only').checked;
  const visible=allCases.filter(c=>(!amazonOnly||c.sourceId==='official-amazon-jp')&&matches(c,filters,now)&&personalMatches(personal.get(c.id),pf));
  $('count').textContent=`${visible.length}件 / 全${allCases.length}件`;
  $('filter-description').textContent=`表示条件：${$('phase').selectedOptions[0].text} ＞ ${filters.receiving.length?filters.receiving.map(x=>receivingLabels[x]).join('・'):'受取方法すべて'}${filters.store?' ＞ 店舗名「'+filters.store+'」':''}${amazonOnly?' ＞ Amazon招待だけ':''}${pf.favorite?' ＞ お気に入り':''}${pf.unapplied?' ＞ 未応募':''}`;
  renderCards($('cases'),visible,now,'<div class="empty"><strong>この条件に合う案件はありません</strong><p>読み込めた公式抽選案内と、個人用画面で保存したAmazonの確認結果が対象です。他の店舗に抽選がないことを意味しません。</p></div>');
}
for(const id of ['phase','store'])$(id).addEventListener(id==='store'?'input':'change',render);
let refreshing=false;
async function refreshSnapshot(){
 if(refreshing)return;refreshing=true;
 try {
  const r=await fetch('./data/snapshot.json',{cache:'no-store'});if(!r.ok)throw new Error('snapshot unavailable');
  const next=await r.json();if(next.schemaVersion!==1||!Array.isArray(next.cases))throw new Error('invalid snapshot');
  const changed=JSON.stringify(next)!==JSON.stringify(snapshot);snapshot=next;
  $('data-notice').textContent=`最終取得：${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(snapshot.fetchedAt))} JST · ${snapshot.updateMode}。${snapshot.sources?.cardlabo?" カードラボは公式一覧の最新3記事のみ。取得："+time(snapshot.sources.cardlabo.fetchedAt)+" JST（初回検証反映・定期取得は未設定）。":""}${snapshot.sources?.pokemoncenter?' ポケモンセンターは最新1記事の日程画像を照合（定期取得は未設定）。':''}${snapshot.sources?.rakutenbooks?' 楽天ブックスは公式商品詳細の抽選日程を独立2回照合（今回検証反映・定期取得は未設定）。':''}受付状態は現在日時で表示します。最新情報は公式案内をご確認ください。`;
  if(changed)render();
 }catch{
  if(snapshot){$('data-notice').textContent='最新データを読み込めなかったため、表示中の情報を保持しています。各案件の取得日時をご確認ください。';}
  else{
   $('data-notice').textContent='情報を読み込めませんでした。案件0件とは判定していません。時間をおいて再読み込みしてください。';
   const opened=[...$('cases').querySelectorAll('article details[open]')].map(d=>[d.closest('[data-id]').dataset.id,[...d.closest('article').querySelectorAll('details')].indexOf(d)]);
  $('cases').innerHTML='<div class="empty"><strong>取得済み情報を表示できません</strong><p>通信またはデータ読み込みに失敗しました。</p></div>';
  }
 }finally{refreshing=false;}
}
await refreshSnapshot();
await personal.sync();
await amazon.sync();
setInterval(()=>{render();if(!document.hidden){personal.sync();amazon.sync();}},30000);
setInterval(()=>{if(!document.hidden)refreshSnapshot();},300000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshSnapshot();personal.sync();amazon.sync();}});
