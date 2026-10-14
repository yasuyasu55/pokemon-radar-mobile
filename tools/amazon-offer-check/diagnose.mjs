import fs from 'node:fs';
import {classifyPage,summarizeHealth} from './page-health.mjs';
const {chromium}=await import('playwright');
const ASINS=['B0GP9QHQ3Y','B0G1XB2STM','B0GXCM4BCZ'];
const results=[];
let stop=false;
for(const pass of [1,2]){
  if(stop) break;
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:1365,height:900},
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'});
  try{
    for(const asin of ASINS){
      const page=await context.newPage();
      const row={asin,pass,startedAt:new Date().toISOString(),samples:[]};
      try{
        const started=Date.now();
        const response=await page.goto('https://www.amazon.co.jp/dp/'+asin,{waitUntil:'domcontentloaded',timeout:25000});
        row.status=response?.status()??null;
        row.contentType=response?.headers()['content-type']?.split(';')[0]||null;
        for(const wait of [1500,6000,10000]){
          const remaining=wait-(Date.now()-started);
          if(remaining>0) await page.waitForTimeout(remaining);
          const f=await page.evaluate(({asin,status})=>{
            const body=document.body?.innerText||'';
            const title=document.querySelector('#productTitle');
            const productTitle=(title?.textContent||'').trim();
            const docTitle=document.title||'';
            const root=document.querySelector('#hdp_buybox_desktop');
            const rootText=root?.innerText||'';
            const visible=n=>Boolean(n&&n.getClientRects().length);
            const button=root?.querySelector('#hdp-invite-button input[name="submit.inviteButton"]');
            return {
              status,expectedDestination:location.hostname==='www.amazon.co.jp'&&location.pathname.includes('/dp/'+asin),
              documentReadyState:document.readyState,bodyLength:body.length,
              documentTitleKind:/captcha|ロボット|robot/i.test(docTitle)?'CHALLENGE':/エラー|error|sorry/i.test(docTitle)?'ERROR':/サインイン|ログイン|sign.?in/i.test(docTitle)?'SIGN_IN':/Amazon/i.test(docTitle)?'AMAZON':'OTHER',
              challenge:Boolean(document.querySelector('#captchacharacters,form[action*="validateCaptcha"]'))||/ロボットではありません|画像に表示されている文字|Enter the characters you see/i.test(body),
              signIn:Boolean(document.querySelector('form[name="signIn"],#ap_email')),
              genericError:/Sorry! Something went wrong|申し訳ありません。問題が発生しました|入力されたウェブアドレスは当社サイトの有効なページではありません|Looking for something\?/i.test(body),
              productTitleNodes:document.querySelectorAll('#productTitle').length,
              spanProductTitleNodes:document.querySelectorAll('span#productTitle').length,
              productTitleLength:productTitle.length,productTitleVisible:visible(title),
              productTitle:/ポケモンカード/.test(productTitle)?productTitle.slice(0,250):null,
              buyboxNodes:document.querySelectorAll('#hdp_buybox_desktop').length,
              invitationPanelVisible:visible(root),asinMatched:Boolean(root?.querySelector('[data-csa-c-asin="'+asin+'"]')),
              amazonSeller:/出荷元\s*\/\s*販売元\s*\nAmazon\.co\.jp(?:\n|$)/.test(rootText),
              invitationNotice:/本商品は招待販売/.test(rootText),
              requestVisible:visible(button),requestEnabled:Boolean(button&&!button.disabled),requestLabelMatches:/招待をリクエスト/.test(button?.value||''),
              normalPurchaseVisible:[...document.querySelectorAll('#add-to-cart-button,#buy-now-button')].some(visible)
            };
          },{asin,status:row.status});
          f.elapsedMs=Date.now()-started;
          row.samples.push(f);
          if(['ACCESS_CHALLENGE','SIGN_IN_WALL','WRONG_DESTINATION'].includes(classifyPage(f))){stop=true;break;}
        }
        Object.assign(row,summarizeHealth(row.samples));
      }catch(e){row.outcome='NAVIGATION_OR_DIAGNOSTIC_FAILED';row.errorType=e.name||'Error';}
      finally{row.finishedAt=new Date().toISOString();results.push(row);await page.close();}
      if(stop) break;
      await new Promise(r=>setTimeout(r,4000));
    }
  }finally{await context.close();await browser.close();}
}
const report={schemaVersion:1,role:'read-only-page-health-diagnostic-not-publication',context:'same-config-as-production',
  requestedAsins:ASINS,stoppedOnChallengeOrWall:stop,results};
fs.writeFileSync('amazon-page-health.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
