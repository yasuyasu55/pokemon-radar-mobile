import {entryState,matches,safeUrl} from './model.mjs';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=d=>d?d.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1/$2/$3'):'未確認';
const time=iso=>iso?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)):'未確認';
const period=p=>p?.start?(p.start.iso?time(p.start.iso):date(p.start.date))+(p.end?' 〜 '+(p.end.iso?time(p.end.iso):date(p.end.date)):''):'未確認';
const row=(label,value,note='')=>`<div class="row"><dt>${esc(label)}</dt><dd>${esc(value)}${note?`<small>${esc(note)}</small>`:''}</dd></div>`;
let snapshot=null, showEvidence=false;
try{showEvidence=localStorage.getItem('radar:show-evidence')==='true';}catch{}
$('show-evidence').checked=showEvidence;
$('settings').onclick=()=>{const open=$('settings-panel').hidden;$('settings-panel').hidden=!open;$('settings').setAttribute('aria-expanded',String(open));};
$('show-evidence').onchange=()=>{showEvidence=$('show-evidence').checked;try{localStorage.setItem('radar:show-evidence',String(showEvidence));}catch{}document.querySelectorAll('.evidence').forEach(n=>n.hidden=!showEvidence);};
function card(c,now) {
  const state=entryState(c,now), labels={before:'応募開始前',open:'受付中',soon:'締切間近',closed:'応募締切済み',unknown:'応募期間未確認'};
  const remaining=c.entryPeriod?.end?.iso?Date.parse(c.entryPeriod.end.iso)-now:null;
  const remainLabel=state==='before'?'受付開始日時をご確認ください':state==='closed'?'受付は終了しています':remaining>0?`締切まで約${Math.ceil(remaining/3600000)}時間`:'締切時刻は未確認';
  const brandMap={};for(const s of c.stores)(brandMap[s.brand]??=[]).push(s.name);
  const groups=Object.entries(brandMap).map(([brand,names])=>`<h4 class="store-brand">${esc(brand)} · ${names.length}店舗</h4><div class="store-list">${names.map(n=>`<span class="store-chip">${esc(n)}</span>`).join('')}</div>`).join('');
  const result=period(c.resultAnnouncement)+(c.resultAnnouncement?.approximate?' 頃':'');
  const href=safeUrl(c.sourceUrl);
  return `<article class="card" data-id="${esc(c.id)}"><div class="card-body"><p class="card-source">${esc(c.sourceName)} · 抽選販売</p><h3>${esc(c.title)}</h3><div class="badges"><span class="badge ${state==='closed'?'gray':state==='soon'?'amber':''}">${labels[state]}</span><span class="badge">${esc(c.applicationMethod)}</span><span class="badge amber">${esc(c.receivingLabel)}</span></div><div class="deadline ${state==='closed'?'closed':state==='soon'?'soon':''}"><small>応募締切 · 日本時間</small><strong>${esc(time(c.entryPeriod?.end?.iso))}</strong><p class="remaining">${esc(remainLabel)}</p></div><dl>${row('応募期間',period(c.entryPeriod))}${row('当選通知',result,'時刻未確認・公式アプリの応募履歴で確認')}${row('購入期間',period(c.purchasePeriod),c.purchasePeriod?.timeQualifier||'時刻未確認')}${row('応募方法',c.applicationMethod,c.webApplicationLabel)}${row('受取方法',c.receivingLabel,'応募時に選んだ店舗への来店が必要')}${row('受取店舗',`${c.stores.length}店舗から応募時に選択`,'所在地・営業時間は未確認。下の店舗一覧で店名を確認')}${row('価格',c.prices.map(p=>p.label).join(' / '))}</dl><div class="callout">会員資格・利用履歴・受取可能な店舗をご確認ください。あなたが応募条件を満たすかは未確認です。</div><section class="conditions"><h4>応募・購入の条件</h4><ul>${c.conditions.map(x=>`<li>${esc(x)}</li>`).join('')}${c.handoverRestrictions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><details class="stores"><summary>受取店舗を見る（${c.stores.length}店舗）</summary><p class="muted">応募時に1店舗を選び、当選後は選択した店舗で購入します。掲載店舗すべてへの来店は不要です。</p>${groups}</details>${href?`<a class="card-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">公式の抽選案内を確認 ↗</a>`:''}<p class="link-note">このリンクは案内ページです。応募は公式アプリ内で行います。</p><details><summary>未確認の項目</summary><ul>${c.unknowns.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details></div><div class="card-bottom">情報取得：${esc(time(c.fetchedAt))} JST · ${esc(c.verification)}</div><div class="evidence" ${showEvidence?'':'hidden'}><details><summary>取得の根拠・補足</summary><p>掲載日：${esc(date(c.publishedDate))} / 取得：${esc(c.fetchedAt)}<br>通常HTTPで独立した2回の取得・抽出を照合。今回の2記事での確認です。</p><pre>${esc(c.evidence.entry)}\n\n${esc(c.evidence.result)}\n\n${esc(c.evidence.purchase)}\n\n${esc(c.evidence.receiving.join('\n'))}</pre></details></div></article>`;
}
function render(){
  if(!snapshot)return;
  const now=Date.now(), filters={phase:$('phase').value,receiving:$('receiving').value,store:$('store').value};
  $('open-count').textContent=snapshot.cases.filter(c=>['open','soon'].includes(entryState(c,now))).length;
  $('soon-count').textContent=snapshot.cases.filter(c=>entryState(c,now)==='soon').length;
  const visible=snapshot.cases.filter(c=>matches(c,filters,now));
  $('count').textContent=`${visible.length}件 / 全${snapshot.cases.length}件`;
  $('filter-description').textContent=`表示条件：${$('phase').selectedOptions[0].text} ＞ ${$('receiving').selectedOptions[0].text}${filters.store?' ＞ 店舗名「'+filters.store+'」':''}`;
  $('cases').innerHTML=visible.length?visible.map(c=>card(c,now)).join(''):'<div class="empty"><strong>この条件に合う案件はありません</strong><p>今回確認したお宝創庫の2記事が対象です。他の店舗に抽選がないことを意味しません。</p></div>';
}
for(const id of ['phase','receiving','store'])$(id).addEventListener(id==='store'?'input':'change',render);
try {
  const r=await fetch('./data/snapshot.json',{cache:'no-store'});if(!r.ok)throw new Error('snapshot unavailable');
  snapshot=await r.json();if(snapshot.schemaVersion!==1||!Array.isArray(snapshot.cases))throw new Error('invalid snapshot');
  $('data-notice').textContent=`最終取得：${date(snapshot.fetchedAt.slice(0,10))} ${time(snapshot.fetchedAt)} JST · ${snapshot.updateMode}。受付状態は現在日時で表示します。最新情報は公式案内をご確認ください。`;
  render();setInterval(render,60000);
}catch{
  $('data-notice').textContent='情報を読み込めませんでした。案件0件とは判定していません。時間をおいて再読み込みしてください。';
  $('cases').innerHTML='<div class="empty"><strong>取得済み情報を表示できません</strong><p>通信またはデータ読み込みに失敗しました。</p></div>';
}
