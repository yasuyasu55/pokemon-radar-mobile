import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function uniq(xs){return [...new Set(xs.filter(Boolean))];}
function xSearchUrl(query){
  return 'https://x.com/search?q='+encodeURIComponent(query)+'&src=typed_query&f=live';
}
export function buildXSocialTargets(config,{generatedAt=new Date().toISOString()}={}){
  if(config.policy!=='candidate-only')throw new Error('X discovery policy must remain candidate-only');
  const targets=[];
  for(const account of config.accounts||[]){
    if(!account.enabled)continue;
    targets.push({
      id:'x-account:'+account.handle.toLowerCase(),
      type:'account',
      url:account.url||('https://x.com/'+account.handle),
      handle:account.handle,
      priority:account.priority||50,
      genres:account.genres||[],
      trust:account.trust||'candidate-only',
      publishDirectly:false
    });
  }
  for(const genre of config.genres||[]){
    const aliases=uniq(genre.aliases||[]);
    if(!aliases.length)continue;
    const aliasExpr=aliases.map(x=>'"'+x+'"').join(' OR ');
    const query='('+aliasExpr+') (抽選 OR 招待 OR 再販 OR 再入荷 OR 購入権)';
    targets.push({
      id:'x-search:'+genre.id,
      type:'live-search',
      url:xSearchUrl(query),
      query,
      priority:genre.priority||50,
      genres:[genre.id],
      trust:'candidate-only',
      publishDirectly:false
    });
  }
  return {
    schemaVersion:1,
    generatedAt,
    consumer:'CRAWL_STORM_X_SOCIAL',
    policy:'candidate-only',
    triggers:uniq(config.triggers||[]),
    profitCandidateSignals:uniq(config.profitCandidateSignals||[]),
    validation:config.validation||{},
    targets:targets.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [configPath,outPath]=process.argv.slice(2);
  if(!configPath||!outPath)throw new Error('Usage: node build-targets.mjs config out');
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  const out=buildXSocialTargets(config);
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({
    accounts:out.targets.filter(x=>x.type==='account').length,
    searches:out.targets.filter(x=>x.type==='live-search').length,
    targets:out.targets.length,
    policy:out.policy
  }));
}
