import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const QUERIES=[
  'ポケモンカード 抽選',
  'ポケモンカード 招待',
  'ポケモン 招待販売'
];
export const MAX_PAGES_PER_QUERY=3;
export const MAX_UNIQUE_ASINS=100;
export const MAX_DETAIL_CHECKS=40;

const sha=s=>createHash('sha256').update(s).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const amazonSearchUrl=(query,page)=>`https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}&page=${page}`;
const asinFromHref=href=>href?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase()??null;
export function isAccessBlocked({status,text='',challengeElement=false}){
  return [403,429,503].includes(status)||challengeElement||/ロボットではありません|画像に表示されている文字|Enter the characters you see|captcha/i.test(text);
}

async function searchPage(page,query,pageNo){
  const url=amazonSearchUrl(query,pageNo);
  const startedAt=new Date().toISOString();
  try{
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1500);
    const title=await page.title();
    const bodySample=(await page.locator('body').innerText({timeout:5000}).catch(()=>'' )).slice(0,1200);
    const status=response?.status()??null;
    const challengeElement=await page.locator('#captchacharacters, form[action*="validateCaptcha"]').count()>0;
    const blocked=isAccessBlocked({status,text:title+'\n'+bodySample,challengeElement});
    if(blocked)return {query,page:pageNo,url,status,stage:'BLOCKED',title,count:null,items:[]};
    if(status!==200)return {query,page:pageNo,url,status,stage:'FETCH_FAILED',title,count:null,items:[]};
    const items=await page.locator('[data-component-type="s-search-result"][data-asin]').evaluateAll(nodes=>nodes.map(n=>{
      const asin=(n.getAttribute('data-asin')||'').toUpperCase();
      const title=n.querySelector('h2 span, h2')?.textContent?.trim()||'';
      const href=n.querySelector('a[href*="/dp/"],a[href*="/gp/product/"]')?.getAttribute('href')||'';
      return {asin,title,href};
    }));
    const filtered=[];
    for(const item of items){
      const asin=/^[A-Z0-9]{10}$/.test(item.asin)?item.asin:asinFromHref(item.href);
      if(!asin)continue;
      if(item.title&&!/ポケモン|Pokemon/i.test(item.title))continue;
      if(/オリパ|中古|福袋/.test(item.title))continue;
      if(!filtered.some(x=>x.asin===asin))filtered.push({asin,title:item.title.slice(0,250)});
    }
    return {query,page:pageNo,url,status:response?.status()??null,stage:'SEARCH_PARSED',title,count:filtered.length,items:filtered};
  }catch(e){
    return {query,page:pageNo,url,stage:'FETCH_FAILED',error:e.message,count:null,items:[],startedAt};
  }
}

async function inspectProduct(context,candidate){
  const page=await context.newPage();
  const url=`https://www.amazon.co.jp/dp/${candidate.asin}`;
  try{
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1200);
    const bodySample=(await page.locator('body').innerText({timeout:5000}).catch(()=>'' )).slice(0,1200);
    const status=response?.status()??null;
    const challengeElement=await page.locator('#captchacharacters, form[action*="validateCaptcha"]').count()>0;
    const blocked=isAccessBlocked({status,text:(await page.title())+'\n'+bodySample,challengeElement});
    if(blocked)return {asin:candidate.asin,url,status,stage:'BLOCKED',candidate:false};
    if(status!==200)return {asin:candidate.asin,url,status,stage:'FETCH_FAILED',candidate:false};
    const title=await page.locator('span#productTitle').innerText({timeout:6000}).catch(()=>null);
    if(!title)return {asin:candidate.asin,url,status:response?.status()??null,stage:'UNEXPECTED_RESPONSE',candidate:false,reason:'商品名を確認できません'};
    const normalized=title.trim().normalize('NFKC');
    if(!/ポケモンカード/.test(normalized)||/オリパ|中古|福袋/.test(normalized))return {asin:candidate.asin,url,status:response?.status()??null,stage:'PRODUCT_PARSED',title:normalized,candidate:false,reason:'対象商品名ではありません'};

    const root=page.locator('#hdp_buybox_desktop');
    if(await root.count()===0)return {asin:candidate.asin,url,status:response?.status()??null,stage:'PRODUCT_PARSED',title:normalized,candidate:false,reason:'招待販売欄を確認できません'};
    const rootText=await root.innerText().catch(()=>'');
    const invitationPanelVisible=await root.isVisible().catch(()=>false);
    const normalPurchaseVisible=await page.locator('#add-to-cart-button, #buy-now-button').evaluateAll(nodes=>nodes.some(n=>n.getClientRects().length>0)).catch(()=>false);
    const asinMatched=await root.locator(`[data-csa-c-asin="${candidate.asin}"]`).count()>0;
    const amazonSeller=/出荷元\s*\/\s*販売元\s*\nAmazon\.co\.jp(?:\n|$)/.test(rootText);
    const notice=root.locator('#hdp-detail-no-requested-id');
    const invitationNotice=await notice.count()>0 && /本商品は招待販売/.test(await notice.innerText().catch(()=>''));
    const input=root.locator('#hdp-invite-button input[name="submit.inviteButton"]');
    const requestButton=await input.count()>0 && await input.isVisible().catch(()=>false) && await input.isEnabled().catch(()=>false) && /招待をリクエスト/.test(await input.getAttribute('value').catch(()=>'')||'');
    const candidateOk=invitationPanelVisible&&asinMatched&&amazonSeller&&invitationNotice&&requestButton;
    return {asin:candidate.asin,url,status:response?.status()??null,stage:'PRODUCT_PARSED',title:normalized,candidate:candidateOk,
      checks:{asinMatched,amazonSeller,invitationNotice,requestButton,invitationPanelVisible},
      offerPresentation:{normalPurchaseVisible,invitationPanelVisible,coexistingOffers:normalPurchaseVisible&&candidateOk},
      reason:candidateOk?'Amazon販売欄で招待販売とリクエスト操作を確認':'招待販売の確定条件が揃いません'};
  }catch(e){
    return {asin:candidate.asin,url,stage:'FETCH_FAILED',candidate:false,error:e.message};
  }finally{
    await page.close();
  }
}

// fixedTargets: check exactly these ASINs (no search), so a second independent run covers the same set as the first.
export async function run(outDir,seedAsins=[],{fixedTargets=null}={}){
  const {chromium}=await import('playwright');
  fs.mkdirSync(outDir,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({
    locale:'ja-JP',
    timezoneId:'Asia/Tokyo',
    viewport:{width:1365,height:900},
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  });
  const result={schemaVersion:1,mode:'BROWSER_POC',pid:process.pid,startedAt:new Date().toISOString(),queries:fixedTargets?[]:QUERIES,fixedTargets:Boolean(fixedTargets),searches:[],discovered:[],details:[],adoption:'NOT_ENABLED'};
  try{
    const discovery=new Map((fixedTargets||seedAsins).filter(a=>/^[A-Z0-9]{10}$/.test(a)).map(asin=>[asin,{asin,title:null,queries:['watch-pool']}]));
    const page=await context.newPage();
    searchLoop: for(const query of (fixedTargets?[]:QUERIES)){
      for(let p=1;p<=MAX_PAGES_PER_QUERY;p++){
        const row=await searchPage(page,query,p);
        result.searches.push(row);
        if(row.stage==='BLOCKED'){result.stoppedOnAccessBlock=true;break searchLoop;}
        if(row.stage==='BLOCKED'||row.stage==='FETCH_FAILED')break;
        for(const item of row.items){
          const existing=discovery.get(item.asin);
          if(existing){if(!existing.queries.includes(query))existing.queries.push(query);}
          else discovery.set(item.asin,{...item,queries:[query]});
          if(discovery.size>=MAX_UNIQUE_ASINS)break;
        }
        if(discovery.size>=MAX_UNIQUE_ASINS||row.count===0)break;
        await sleep(1200);
      }
      if(discovery.size>=MAX_UNIQUE_ASINS)break;
    }
    await page.close();
    result.discovered=[...discovery.values()];
    for(const item of (result.stoppedOnAccessBlock?[]:result.discovered.slice(0,MAX_DETAIL_CHECKS))){
      const row=await inspectProduct(context,item);
      result.details.push(row);
      if(row.stage==='BLOCKED'){result.stoppedOnAccessBlock=true;break;}
      await sleep(1000);
    }
    result.finishedAt=new Date().toISOString();
    const searchOk=(fixedTargets||seedAsins).length>0 || result.searches.some(x=>x.stage==='SEARCH_PARSED'&&x.count>0);
    const detailOk=result.details.some(x=>x.stage==='PRODUCT_PARSED');
    result.verdict=searchOk&&detailOk?'BROWSER_PATH_WORKS':result.searches.some(x=>x.stage==='BLOCKED')||result.details.some(x=>x.stage==='BLOCKED')?'BLOCKED':'NOT_VERIFIED';
    result.stats={searchPages:result.searches.length,uniqueAsins:result.discovered.length,detailChecks:result.details.length,invitationCandidates:result.details.filter(x=>x.candidate).length};
    fs.writeFileSync(path.join(outDir,'result.json'),JSON.stringify(result,null,2)+'\n');
    fs.writeFileSync(path.join(outDir,'SUMMARY.md'),`# Amazon Chromium PoC\n\n判定: ${result.verdict}\n\n検索ページ: ${result.stats.searchPages}\n\nユニークASIN: ${result.stats.uniqueAsins}\n\n商品詳細確認: ${result.stats.detailChecks}\n\n招待販売候補: ${result.stats.invitationCandidates}\n\n本番採用・公開反映: 無効\n`);
    console.log(JSON.stringify({verdict:result.verdict,stats:result.stats,searches:result.searches.map(x=>({query:x.query,page:x.page,status:x.status,stage:x.stage,count:x.count})),candidates:result.details.filter(x=>x.candidate).map(x=>({asin:x.asin,title:x.title}))}));
    return result.verdict==='BROWSER_PATH_WORKS'?0:10;
  }finally{
    await context.close();
    await browser.close();
  }
}

const here=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===here){
  const out=process.argv[2];
  if(!out)throw new Error('Usage: node browser-probe.mjs output-directory');
  process.exitCode=await run(out);
}

