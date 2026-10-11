export const jstDate = now => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function entryState(c, now=Date.now()) {
  if(c?.lotteryType==='INVITATION_SALE'&&c?.invitationState==='REQUESTABLE') return 'open';
  const start=c.entryPeriod?.start?.iso, end=c.entryPeriod?.end?.iso;
  if(!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))) return 'unknown';
  if(now<Date.parse(start)) return 'before';
  if(now>=Date.parse(end)) return 'closed';
  return Date.parse(end)-now<=86400000?'soon':'open';
}
export function matches(c, filters, now=Date.now()) {
  const state=entryState(c,now);
  const phases=Array.isArray(filters.phases)?filters.phases:['open','soon','unknown','before'];
  if(!phases.includes(state))return false;
  const receiving=Array.isArray(filters.receiving)?filters.receiving:filters.receiving&&filters.receiving!=='all'?[filters.receiving]:[];
  const effectiveReceivingMethod=c?.sourceId==='official-amazon-jp'&&c?.lotteryType==='INVITATION_SALE'?'DELIVERY':c.receivingMethod;
  if(receiving.length&&!receiving.some(kind=>kind==='delivery'?['DELIVERY','BOTH'].includes(effectiveReceivingMethod):kind==='store'?['STORE_ONLY','BOTH'].includes(effectiveReceivingMethod):kind==='unknown'?!['STORE_ONLY','DELIVERY','BOTH'].includes(effectiveReceivingMethod):false))return false;
  const q=(filters.store||'').trim().toLocaleLowerCase();
  return !q||c.stores.some(s=>(s.brand+' '+s.name).toLocaleLowerCase().includes(q));
}
export function safeUrl(value) {try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}

export function deadlineDisplay(c,now=Date.now()) {
  const end=c.entryPeriod?.end, ms=end?.iso?Date.parse(end.iso):NaN;
  if(!Number.isFinite(ms))return {tone:'unknown',dateLabel:end?.date?end.date.replace(/-/g,'/')+'（時刻未確認）':'未確認',remainingLabel:'締切時刻未確認（残り時間は計算できません）'};
  const dateLabel=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ms));
  const remaining=ms-now;
  if(remaining<=0)return {tone:'closed',dateLabel,remainingLabel:'応募締切は終了しています'};
  const minutes=Math.ceil(remaining/60000);
  let label;
  if(minutes<60)label=`${minutes}分`;
  else{
    const hours=Math.ceil(minutes/60),days=Math.floor(hours/24),rest=hours%24;
    label=days?`${days}日${rest?`${rest}時間`:''}`:`${hours}時間`;
  }
  return {tone:remaining<=86400000?'soon':'open',dateLabel,remainingLabel:`締切まであと約${label}`};
}
