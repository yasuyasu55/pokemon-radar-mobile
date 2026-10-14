import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractPostCandidates} from './normalize-links.mjs';
import {mergeDiscoveredAsins} from '../amazon-watch/asin-pool.mjs';

export const HANDLES = ['pokecamatomeru','pokecasokuhou','lifeprep_list','kotatsudemikanm','mymyme0901','manimegame336','medakadesu41','PokeGetInfoMain','pokecayoyaku'];
const numeric = x => typeof x === 'string' && /^\d+$/.test(x);
export function toPost(handle, t) {
  if (!numeric(t.id) || typeof t.text !== 'string') throw new Error('Malformed X post');
  return {handle, postId:t.id, postUrl:`https://x.com/${handle}/status/${t.id}`, text:t.text,
    postedAt:t.created_at || null, urls:(t.entities?.urls || []).map(u=>u.unwound_url || u.expanded_url || u.url).filter(Boolean)};
}
export async function collectAccount(handle, old = {}, request, processPosts, {maxPages=3}={}) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('Invalid handle');
  const state = structuredClone(old);
  if (!state.userId) {
    const u = await request(`/2/users/by/username/${handle}`);
    if (!numeric(u.data?.id)) throw new Error('X user unresolved');
    state.userId = u.data.id;
  }
  // Keep the confirmed lower bound fixed until every pending page is persisted.
  const pending = state.pending || {sinceId:state.sinceId || null, token:null, newestId:null};
  const posts=[];
  for(let page=0; page<maxPages; page++) {
    const params = new URLSearchParams({max_results:'20','tweet.fields':'created_at,entities'});
    if(pending.sinceId) params.set('since_id',pending.sinceId);
    if(pending.token) params.set('pagination_token',pending.token);
    let response;
    try { response = await request(`/2/users/${state.userId}/tweets?${params}`); }
    catch(e) {
      // Invalidated pagination tokens replay from the confirmed bound next run.
      if(e.status === 400 && pending.token) state.pending = null;
      else state.pending = pending;
      return {state,posts,outcome:e.status===429?'rate-limited':'failed',status:e.status || null};
    }
    if(response.errors?.length || !response.meta || !Array.isArray(response.data || [])) {
      return {state:{...state,pending},posts,outcome:'invalid-response'};
    }
    const batch = (response.data || []).map(t=>toPost(handle,t));
    try { await processPosts(batch); }
    catch { return {state:{...state,pending},posts,outcome:'processing-failed'}; }
    posts.push(...batch);
    for(const p of batch) if(!pending.newestId || BigInt(p.postId)>BigInt(pending.newestId)) pending.newestId=p.postId;
    pending.token = response.meta.next_token || null;
    if(!pending.token) {
      state.sinceId = pending.newestId || pending.sinceId;
      state.pending = null;
      return {state,posts,outcome:posts.length?'ok':'ok-zero-posts'};
    }
  }
  return {state:{...state,pending},posts,outcome:'partial'};
}

// X acquisition state, kept apart from Amazon verification. No token means X is NOT RUNNING (never "partial").
export function summarizeAcquisition({tokenSet, accounts, handles=HANDLES}) {
  const apiOk = x => ['ok','ok-zero-posts'].includes(x.outcome);
  if(!tokenSet) {
    const usable = accounts.filter(x=>x.outcome==='public-sample').length;
    return {auth:'UNSET', collection:'NOT_RUNNING', status:'NOT_RUNNING_AUTH_UNSET',
      notice:'X_BEARER_TOKEN is not set. X API acquisition is not running, so no X monitoring coverage exists.',
      publicFallback:{role:'supplementary visible-sample attempt only; not monitoring', attempted:accounts.length, usable, failed:accounts.length-usable}};
  }
  const complete = accounts.length===handles.length && accounts.every(apiOk);
  return {auth:'SET', collection:'RUNNING_API', status: complete ? 'OK' : 'PARTIAL_OR_FAILED',
    summary:{ok:accounts.filter(apiOk).length, failed:accounts.filter(x=>!apiOk(x)).length, total:handles.length}};
}
function atomic(file, value) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file); }
const read = (p, fallback) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : fallback;
export async function run(directory, {token=process.env.X_BEARER_TOKEN}={}) {
  const stateFile=path.join(directory,'x-collection-state.json'), candidateFile=path.join(directory,'x-candidates.json');
  const state=read(stateFile,{schemaVersion:1,accounts:{}});
  const retained=read(candidateFile,{amazon:[],official:[],review:[]});
  const report={checkedAt:new Date().toISOString(),method:'official-api',accounts:[],publication:'candidate-only'};
  report.apiConfigured=Boolean(token);
  const request=async route=>{
    const r=await fetch('https://api.x.com'+route,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!r.ok){await r.body?.cancel(); const e=new Error('X API HTTP '+r.status);e.status=r.status;throw e;}
    const body=await r.text(); if(body.length>2*1024*1024) throw new Error('X response too large');
    return JSON.parse(body);
  };
  const resolveRedirect=async url=>{
    const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    const loc=r.status>=300 && r.status<400 ? r.headers.get('location'):null;
    await r.body?.cancel();return loc;
  };
  const processPosts=async posts=>{
    const next=await extractPostCandidates(posts,{resolveRedirect});
    for(const type of ['amazon','official']) {
      const map=new Map(retained[type].map(c=>[c.asin || c.canonicalUrl,c]));
      for(const c of next[type]) {
        const key=c.asin || c.canonicalUrl;
        if(!map.has(key)) map.set(key,c);
        else {const row=map.get(key);row.evidence=[...new Map([...row.evidence,...c.evidence].map(e=>[JSON.stringify(e),e])).values()];}
      }
      retained[type]=[...map.values()];
    }
    retained.review=[...new Map([...retained.review,...next.review].map(e=>[JSON.stringify(e),e])).values()].slice(-1000);
    atomic(candidateFile,{schemaVersion:1,policy:'candidate-only',...retained});
  };
  if(!token) {
    report.method='none';report.apiConfigured=false;
    // Do not repeatedly hit denied public profiles on the scheduled production path.
    // Public samples can be studied separately; they are not monitoring coverage.
  } else for(const handle of HANDLES) {
    try {
      const result=await collectAccount(handle,state.accounts[handle],request,processPosts);
      state.accounts[handle]=result.state;atomic(stateFile,state);
      report.accounts.push({handle,outcome:result.outcome,posts:result.posts.length,status:result.status || null});
      if(result.status===429 || result.status===401) break;
    } catch(e) {report.accounts.push({handle,outcome:'failed',status:e.status || null});if([401,429].includes(e.status))break;}
  }
  Object.assign(report,summarizeAcquisition({tokenSet:Boolean(token),accounts:report.accounts}));
  report.amazonCandidates=retained.amazon.length;report.officialCandidates=retained.official.length;
  atomic(path.join(directory,'x-collection-status.json'),report);
  // Discovery input only; never write public snapshot from X text.
  const poolFile=path.join(directory,'amazon-asin-pool.json');
  const pool=mergeDiscoveredAsins(read(poolFile,{items:[]}),retained.amazon.map(c=>({asin:c.asin,query:'x-social'})));
  for(const item of pool.items) if(!item.source || item.queries?.includes('x-social')) item.discoverySources=[...new Set([...(item.discoverySources||[]),'x-social'])];
  atomic(poolFile,pool);
  console.log(JSON.stringify(report));
  // 0 = API run complete, 11 = X not running (auth unset), 10 = API run incomplete.
  return report.status==='OK'?0:report.status==='NOT_RUNNING_AUTH_UNSET'?11:10;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) process.exitCode=await run(process.argv[2] || 'data/internal');
