import fs from 'node:fs';
import path from 'node:path';
export function reserveDay(dir,now=new Date()){
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 fs.mkdirSync(dir,{recursive:true});
 try{fs.writeFileSync(path.join(dir,day+'.json'),JSON.stringify({day,startedAt:now.toISOString()}),{flag:'wx'});return true;}
 catch(e){if(e.code==='EEXIST')return false;throw e;}
}
export function publicHasCases(snapshot,expected){
 if(snapshot?.schemaVersion!==1||!Array.isArray(snapshot.cases)||!expected.length)return false;
 const byId=new Map(snapshot.cases.map(c=>[c.id,c]));
 return expected.every(c=>{const actual=byId.get(c.id);return actual?.fetchedAt===c.fetchedAt&&actual?.title===c.title&&actual?.sourceUrl===c.sourceUrl;});
}
