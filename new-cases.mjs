export class NewCaseTracker {
 constructor(storage){this.storage=storage;this.key='pokemon-radar-new-cases-v1';this.state=null;this.available=true;try{const raw=storage?.getItem(this.key);if(raw){const s=JSON.parse(raw);if(!Array.isArray(s.seen)||!Array.isArray(s.pending))throw Error();this.state=s;}}catch{this.available=false;}}
 update(cases){const ids=[...new Set(cases.map(c=>c.id).filter(id=>typeof id==='string'))];if(!this.state)this.state={seen:ids,pending:[]};else{const seen=new Set(this.state.seen);this.state.pending=[...new Set([...this.state.pending,...ids.filter(id=>!seen.has(id))])];this.state.seen=[...new Set([...this.state.seen,...ids])];}this.save();return new Set(this.state.pending);}
 acknowledge(){if(this.state){this.state.pending=[];this.save();}}
 save(){try{if(!this.storage)throw Error();this.storage.setItem(this.key,JSON.stringify(this.state));}catch{this.available=false;}}
 has(id){return this.state?.pending.includes(id)??false;}
}
