// Test-only browser substitution. Never invoked by production workflows.
export async function load(url,context,nextLoad){
  if(url.endsWith('/tools/amazon-browser-probe/browser-probe.mjs')) return {format:'module',shortCircuit:true,source:`
    import fs from 'node:fs';
    import path from 'node:path';
    export async function run(out,seeds,{fixedTargets=null}={}){
      fs.mkdirSync(out,{recursive:true});
      const targets=fixedTargets || seeds.slice(0,2);
      const details=targets.map(asin=>({asin,url:'https://www.amazon.co.jp/dp/'+asin,title:'ポケモンカードゲーム BOX',candidate:true,status:200,stage:'PRODUCT_PARSED',checks:{asinMatched:true,amazonSeller:true,invitationNotice:true,requestButton:true,invitationPanelVisible:true}}));
      const result={mode:'BROWSER_POC',pid:process.pid,finishedAt:new Date().toISOString(),fixedTargets:Boolean(fixedTargets),searches:fixedTargets?[]:[{stage:'SEARCH_PARSED',count:1}],details,discovered:targets.map(asin=>({asin})),receivedSeeds:seeds};
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result));
      return 0;
    }
  `};
  return nextLoad(url,context);
}
