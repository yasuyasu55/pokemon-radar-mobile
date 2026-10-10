export const jstDate = now => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function entryState(c, now=Date.now()) {
  const start=c.entryPeriod?.start?.iso, end=c.entryPeriod?.end?.iso;
  if(!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))) return 'unknown';
  if(now<Date.parse(start)) return 'before';
  if(now>=Date.parse(end)) return 'closed';
  return Date.parse(end)-now<=86400000?'soon':'open';
}
export function matches(c, filters, now=Date.now()) {
  const state=entryState(c,now);
  if(filters.phase==='open'&&!['open','soon'].includes(state))return false;
  if(filters.phase==='soon'&&state!=='soon')return false;
  if(filters.phase==='closed'&&state!=='closed')return false;
  if(filters.receiving==='delivery'&&!['DELIVERY','BOTH'].includes(c.receivingMethod))return false;
  if(filters.receiving==='store'&&!['STORE_ONLY','BOTH'].includes(c.receivingMethod))return false;
  if(filters.receiving==='unknown'&&['STORE_ONLY','DELIVERY','BOTH'].includes(c.receivingMethod))return false;
  const q=(filters.store||'').trim().toLocaleLowerCase();
  return !q||c.stores.some(s=>(s.brand+' '+s.name).toLocaleLowerCase().includes(q));
}
export function safeUrl(value) {try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
