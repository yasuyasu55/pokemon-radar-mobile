export const SYNC_URL='https://pokemon-radar-personal.precious-masa1997.chatgpt.site/radar/index.html';
const empty=()=>({records:{},pending:{}});
export function personalMatches(record={},filter={}){
 return (!filter.favorite||record.favorite===true)&&(!filter.unapplied||record.applied!==true);
}
export class PersonalStore{
 constructor({cloud=false,storage,fetcher=fetch,onChange=()=>{}}={}){
  this.cloud=cloud;this.storage=storage;this.fetcher=fetcher;this.onChange=onChange;this.busy=false;this.ready=!cloud;this.message=cloud?'同期を確認しています…':'このブラウザに保存';this.data=empty();
  try{const d=JSON.parse(storage?.getItem('radar:personal:v1')||'null');if(d&&d.records&&d.pending)this.data=d;}catch{}
 }
 get(id){return this.data.records[id]||{};}
 save(){try{this.storage?.setItem('radar:personal:v1',JSON.stringify(this.data));return !!this.storage;}catch{this.message='端末に保存できません。画面を閉じると未同期の記録が失われます。';return false;}}
 notify(){this.onChange();}
 async toggle(id,field){
  if(!['applied','favorite'].includes(field))return;
  const value=!this.get(id)[field],now=new Date().toISOString();
  this.data.records[id]={...this.get(id),[field]:value,...(field==='applied'?{appliedAt:value?now:null}:{})};
  if(this.cloud)this.data.pending[`${id}|${field}`]={caseId:id,field,value,at:now};
  const saved=this.save();
  if(saved)this.message=this.cloud?'未同期の変更を保存しています…':'このブラウザに保存しました';
  this.notify();if(this.cloud)await this.sync();
 }
 overlay(){for(const p of Object.values(this.data.pending))this.data.records[p.caseId]={...this.get(p.caseId),[p.field]:p.value,...(p.field==='applied'?{appliedAt:p.value?p.at:null}:{})};}
 async sync(){
  if(!this.cloud||this.busy)return;this.busy=true;
  try{
   let r=await this.fetcher('/api/state',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error('read');
   let d=await r.json();if(!d.records||typeof d.records!=='object')throw new Error('invalid');
   this.ready=true;this.data.records=d.records;this.overlay();
   for(const [key,p] of Object.entries(this.data.pending)){
    r=await this.fetcher('/api/state',{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId:p.caseId,field:p.field,value:p.value})});
    if(!r.ok)throw new Error('write');
    // A second click during a request must remain pending.
    if(this.data.pending[key]===p)delete this.data.pending[key];
    this.save();
   }
   r=await this.fetcher('/api/state',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error('read');
   d=await r.json();if(!d.records||typeof d.records!=='object')throw new Error('invalid');
   this.data.records=d.records;this.overlay();
   this.message=Object.keys(this.data.pending).length?'未同期の変更があります':'同期済み · PC・スマホで共有';this.save();
  }catch{this.message='同期できていません。通信回復後に再試行します。';this.overlay();this.save();}
  finally{this.busy=false;this.notify();}
 }
}
