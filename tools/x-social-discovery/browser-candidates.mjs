import {extractPostCandidates} from './normalize-links.mjs';
import {mergeDiscoveredAsins} from '../amazon-watch/asin-pool.mjs';
export const BROWSER_HANDLES=['pokecamatomeru','pokecasokuhou','lifeprep_list'];
export function normalizeVisiblePosts(handle,rows){
 const posts=new Map();
 for(const row of rows){
  let u;try{u=new URL(row.url,'https://x.com');}catch{continue;}
  const m=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
  if(u.hostname!=='x.com'||!m||m[1].toLowerCase()!==handle.toLowerCase()||!row.text?.trim())continue;
  posts.set(m[2],{handle,postId:m[2],postUrl:u.origin+u.pathname,text:row.text,postedAt:row.postedAt||null,urls:row.urls||[],notice:'Visible sample; pinned and old posts may be present. Not proof of current acceptance.'});
 }
 return [...posts.values()];
}
export async function ingestVisiblePosts(posts,previous,pool){
 const found=await extractPostCandidates(posts);
 const next={schemaVersion:1,policy:'candidate-only'};
 for(const type of ['amazon','official']){
  const map=new Map();
  for(const c of [...(previous[type]||[]),...found[type]]){
   const key=c.asin||c.canonicalUrl;
   const evidence=(c.evidence||[]).map(({handle,postUrl,postedAt})=>({handle,postUrl,postedAt}));
   const {originalUrl,...clean}=c;
   const old=map.get(key);
   map.set(key,{...clean,evidence:[...new Map([...(old?.evidence||[]),...evidence].map(e=>[JSON.stringify(e),e])).values()],verificationRequired:true,publishDirectly:false});
  }
  next[type]=[...map.values()];
 }
 // Do not persist affiliate URLs or raw post text. Short links stay unresolved.
 next.review=found.review.map(({reason,handle,postUrl,postedAt})=>({reason,handle,postUrl,postedAt}));
 const existing=new Set((pool.items||[]).map(x=>x.asin));
 const merged=mergeDiscoveredAsins(pool,found.amazon.map(c=>({asin:c.asin,query:'x-browser'})));
 for(const item of merged.items)if(found.amazon.some(c=>c.asin===item.asin)){
  if(!existing.has(item.asin))item.source='x-browser';
  item.discoverySources=[...new Set([...(item.discoverySources||[]),'x-browser'])];
 }
 return {candidates:next,pool:merged,counts:{posts:posts.length,amazon:found.amazon.length,official:found.official.length,unresolved:found.review.length,newAsins:found.amazon.filter(c=>!existing.has(c.asin)).length}};
}
