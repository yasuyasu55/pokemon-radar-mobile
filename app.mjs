import {PersonalStore,personalMatches,favoriteCases} from './personal.mjs?v=0113';
import {entryState,matches,safeUrl,deadlineDisplay} from './model.mjs?v=0112';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=d=>d?d.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1/$2/$3'):'未確認';
const time=iso=>iso?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)):'未確認';
const period=p=>p?.start?(p.start.iso?time(p.start.iso):date(p.start.date))+(p.end?' 〜 '+(p.end.iso?time(p.end.iso):date(p.end.date)):''):'未確認';
const row=(label,value,note='')=>`<div class="row"><dt>${esc(label)}</dt><dd>${esc(value)}${note?`<small>${esc(note)}</small>`:''}</dd></div>`;
let snapshot=null, showEvidence=false;
const cloud=document.documentElement.dataset.cloudSync==='true';
let storage;try{storage=localStorage;}catch{}
const personal=new PersonalStore({cloud,storage,onChange:()=>{updatePersonalStatus();render();}});
function updatePersonalStatus(){
 $('sync-status').textContent=personal.message;
 $('sync-link').hidden=cloud;$('retry-sync').hidden=!cloud;
 $('sync-help').textContent=cloud?'同じChatGPTアカウントでこの個人用URLを開くと、PC・スマホで記録を共有できます。応募手続きは公式アプリ等で行ってください。':'この画面は端末内保存です。端末間で共有する場合は個人用画面をお使いください。こちらの記録は自動移行されません。';
}
updatePersonalStatus();
$('retry-sync').onclick=()=>personal.sync();
 $('unapplied-only').onchange=render;
function handlePersonalClick(e){
 const button=e.target.closest('button[data-personal]');if(!button)return;
 const article=button.closest('[data-id]');personal.toggle(article.dataset.id,button.dataset.personal);
 if(button.dataset.personal==='favorite'&&personal.get(article.dataset.id).favorite)$('favorites-panel').open=true;
}
$('cases').addEventListener('click',handlePersonalClick);
$('favorite-cases').addEventListener('click',handlePersonalClick);
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
  const record=personal.get(c.id);
  const state=entryState(c,now), labels={before:'応募開始前',open:'受付中',soon:'締切間近',closed:'応募締切済み',unknown:'応募期間未確認'};
  const deadline=deadlineDisplay(c,now);
  const brandMap={};for(const s of c.stores)(brandMap[s.brand]??=[]).push(s.name);
  const groups=Object.entries(brandMap).map(([brand,names])=>`<h4 class="store-brand">${esc(brand)} · ${names.length}店舗</h4><div class="store-list">${names.map(n=>`<span class="store-chip">${esc(n)}</span>`).join('')}</div>`).join('');
  const result=period(c.resultAnnouncement)+(c.resultAnnouncement?.approximate?' 頃':'');
  const href=safeUrl(c.sourceUrl);
  return `<article class="card" data-id="${esc(c.id)}"><div class="card-body"><p class="card-source">${esc(c.sourceName)} · 抽選販売</p><div class="card-title"><h3>${esc(c.title)}</h3><button type="button" class="favorite-button ${record.favorite?'selected':''}" data-personal="favorite" aria-pressed="${!!record.favorite}" aria-label="${record.favorite?'お気に入りを解除':'お気に入りに追加'}">${record.favorite?'★':'☆'}</button></div><div class="applied-control"><button type="button" data-personal="applied" class="applied-button ${record.applied?'selected':''}" aria-pressed="${!!record.applied}">${record.applied?'✓ 応募済み（タップで戻す）':'応募済みにする'}</button><span>${record.appliedAt?'記録：'+esc(time(record.appliedAt))+' JST':'未応募'}</span></div><div class="badges"><span class="badge ${state==='closed'?'gray':state==='soon'?'amber':''}">${labels[state]}</span><span class="badge">${esc(c.applicationMethod)}</span><span class="badge amber">${esc(c.receivingLabel)}</span></div><div class="deadline ${deadline.tone}"><small>応募締切 · 日本時間</small><strong>${esc(deadline.dateLabel)}</strong><p class="remaining">${esc(deadline.remainingLabel)}</p></div><dl>${row('応募期間',period(c.entryPeriod))}${row('当選通知',result,'時刻未確認・公式アプリの応募履歴で確認')}${row('購入期間',period(c.purchasePeriod),c.purchasePeriod?.timeQualifier||'時刻未確認')}${row('応募方法',c.applicationMethod,c.webApplicationLabel)}${row('受取方法',c.receivingLabel,'応募時に選んだ店舗への来店が必要')}${row('受取店舗',`${c.stores.length}店舗から応募時に選択`,'所在地・営業時間は未確認。下の店舗一覧で店名を確認')}${row('価格',c.prices.map(p=>p.label).join(' / '))}</dl><div class="callout">会員資格・利用履歴・受取可能な店舗をご確認ください。あなたが応募条件を満たすかは未確認です。</div><details class="conditions"><summary>応募・購入の条件を見る（${c.conditions.length+c.handoverRestrictions.length}項目）</summary><ul>${c.conditions.map(x=>`<li>${esc(x)}</li>`).join('')}${c.handoverRestrictions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details><details class="stores"><summary>受取店舗を見る（${c.stores.length}店舗）</summary><p class="muted">応募時に1店舗を選び、当選後は選択した店舗で購入します。掲載店舗すべてへの来店は不要です。</p>${groups}</details>${href?`<a class="card-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">公式の抽選案内を確認 ↗</a>`:''}<p class="link-note display-supplementary">このリンクは案内ページです。応募は公式アプリ内で行います。</p><details><summary>未確認の項目</summary><ul>${c.unknowns.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details></div><div class="card-bottom">${c.retainedFromPrevious?'前回の確認情報を保持 · ' : ''}情報取得：${esc(time(c.fetchedAt))} JST <span class="display-supplementary">· ${esc(c.verification)}</span></div><div class="evidence" ${showEvidence?'':'hidden'}><details><summary>取得の根拠・補足</summary><p>掲載日：${esc(date(c.publishedDate))} / 取得：${esc(c.fetchedAt)}<br>通常HTTPで独立した2回の取得・抽出を照合。今回取得できた記事での確認です。</p><pre>${esc(c.evidence.entry)}\n\n${esc(c.evidence.result)}\n\n${esc(c.evidence.purchase)}\n\n${esc(c.evidence.receiving.join('\n'))}</pre></details></div></article>`;
}
function renderCards(container,cases,now,empty){
 const opened=[...container.querySelectorAll('article details[open]')].map(d=>[d.closest('[data-id]').dataset.id,[...d.closest('article').querySelectorAll('details')].indexOf(d)]);
 container.innerHTML=cases.length?cases.map(c=>card(c,now)).join(''):empty;
 for(const [id,index] of opened){const article=[...container.querySelectorAll('[data-id]')].find(a=>a.dataset.id===id);const d=article?.querySelectorAll('details')[index];if(d)d.open=true;}
}
function render(){
  if(!snapshot)return;
  const now=Date.now(), filters={phase:$('phase').value,receiving:selectedReceiving(),store:$('store').value};
  $('open-count').textContent=snapshot.cases.filter(c=>['open','soon'].includes(entryState(c,now))).length;
  $('soon-count').textContent=snapshot.cases.filter(c=>entryState(c,now)==='soon').length;
  const favorites=favoriteCases(snapshot.cases,personal.data.records);
  $('favorite-count').textContent=favorites.length;
  renderCards($('favorite-cases'),favorites,now,'<div class="empty"><strong>お気に入りはまだありません</strong><p>案件の☆を押すと、ここにまとめて表示されます。</p></div>');
  const pf={unapplied:$('unapplied-only').checked};
  const visible=snapshot.cases.filter(c=>matches(c,filters,now)&&personalMatches(personal.get(c.id),pf));
  $('count').textContent=`${visible.length}件 / 全${snapshot.cases.length}件`;
  $('filter-description').textContent=`表示条件：${$('phase').selectedOptions[0].text} ＞ ${filters.receiving.length?filters.receiving.map(x=>receivingLabels[x]).join('・'):'受取方法すべて'}${filters.store?' ＞ 店舗名「'+filters.store+'」':''}${pf.favorite?' ＞ お気に入り':''}${pf.unapplied?' ＞ 未応募':''}`;
  renderCards($('cases'),visible,now,'<div class="empty"><strong>この条件に合う案件はありません</strong><p>取得・検証済みのお宝創庫の記事が対象です。他の店舗に抽選がないことを意味しません。</p></div>');
}
for(const id of ['phase','store'])$(id).addEventListener(id==='store'?'input':'change',render);
let refreshing=false;
async function refreshSnapshot(){
 if(refreshing)return;refreshing=true;
 try {
  const r=await fetch('./data/snapshot.json',{cache:'no-store'});if(!r.ok)throw new Error('snapshot unavailable');
  const next=await r.json();if(next.schemaVersion!==1||!Array.isArray(next.cases))throw new Error('invalid snapshot');
  const changed=JSON.stringify(next)!==JSON.stringify(snapshot);snapshot=next;
  $('data-notice').textContent=`最終取得：${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(snapshot.fetchedAt))} JST · ${snapshot.updateMode}。受付状態は現在日時で表示します。最新情報は公式案内をご確認ください。`;
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
setInterval(()=>{render();if(!document.hidden)personal.sync();},30000);
setInterval(()=>{if(!document.hidden)refreshSnapshot();},300000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshSnapshot();personal.sync();}});
