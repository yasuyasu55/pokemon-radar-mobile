const signature=c=>JSON.stringify([c.entryPeriod?.start?.iso??null,c.entryPeriod?.end?.iso??null]);
export class NewCaseTracker {
 constructor(storage){this.storage=storage;this.key='pokemon-radar-new-cases-v1';this.state=null;this.available=true;try{const raw=storage?.getItem(this.key);if(raw){const s=JSON.parse(raw);if(!Array.isArray(s.seen)||!Array.isArray(s.pending))throw Error();this.state=s;}}catch{this.available=false;}}
 update(cases){
  const valid=cases.filter(c=>typeof c.id==='string'),ids=[...new Set(valid.map(c=>c.id))];
  const signatures=Object.fromEntries(valid.map(c=>[c.id,signature(c)]));
  if(!this.state)this.state={seen:ids,pending:[],reopened:[],signatures};
  else{
   const seen=new Set(this.state.seen),previous=this.state.signatures??{};
   const reopened=valid.filter(c=>seen.has(c.id)&&previous[c.id]!==undefined&&previous[c.id]!==signatures[c.id]).map(c=>c.id);
   this.state.pending=[...new Set([...this.state.pending,...ids.filter(id=>!seen.has(id)),...reopened])];
   this.state.reopened=[...new Set([...(this.state.reopened??[]),...reopened])];
   this.state.seen=[...new Set([...this.state.seen,...ids])];
   this.state.signatures={...previous,...signatures};
  }
  this.save();return new Set(this.state.pending);
 }
 acknowledge(){if(this.state){this.state.pending=[];this.state.reopened=[];this.save();}}
 save(){try{if(!this.storage)throw Error();this.storage.setItem(this.key,JSON.stringify(this.state));}catch{this.available=false;}}
 has(id){return this.state?.pending.includes(id)??false;}
 isReopened(id){return this.has(id)&&(this.state?.reopened??[]).includes(id);}
}
