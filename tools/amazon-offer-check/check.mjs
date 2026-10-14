import fs from 'node:fs';
const {chromium}=await import('playwright');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
const results=[];
try {
 for(const asin of ['B0GP9QHQ3Y','B0G1XB2STM']) {
  const page=await context.newPage();
  try {
   const response=await page.goto(`https://www.amazon.co.jp/dp/${asin}`,{waitUntil:'domcontentloaded',timeout:25000});
   await page.waitForTimeout(1500);
   const status=response?.status();
   const title=await page.locator('#productTitle').innerText().catch(()=>null);
   if(status!==200 || !title) {results.push({asin,status,outcome:'unconfirmed'});continue;}
   const root=page.locator('#hdp_buybox_desktop');
   const visible=await root.isVisible().catch(()=>false);
   const rootText=await root.innerText().catch(()=>'');
   const button=root.locator('#hdp-invite-button input[name="submit.inviteButton"]');
   const requestVisible=await button.isVisible().catch(()=>false);
   const requestEnabled=await button.isEnabled().catch(()=>false);
   const requestLabel=await button.getAttribute('value').catch(()=>null);
   const sellerAmazon=/出荷元\s*\/\s*販売元\s*\nAmazon\.co\.jp(?:\n|$)/.test(rootText);
   const invitationNotice=/本商品は招待販売/.test(rootText);
   const asinMatched=await root.locator(`[data-csa-c-asin="${asin}"]`).count().catch(()=>0)>0;
   const normalPurchaseVisible=await page.locator('#add-to-cart-button, #buy-now-button').evaluateAll(ns=>ns.some(n=>n.getClientRects().length>0));
   const requestable=visible && requestVisible && requestEnabled && /招待をリクエスト/.test(requestLabel||'') && sellerAmazon && invitationNotice && asinMatched;
   results.push({asin,status,title,checkedAt:new Date().toISOString(),invitationPanelVisible:visible,
    sellerAmazon,invitationNotice,asinMatched,requestVisible,requestEnabled,requestLabel,normalPurchaseVisible,
    outcome:requestable?'REQUESTABLE':'UNCONFIRMED',coexist:requestable&&normalPurchaseVisible});
  } catch {results.push({asin,outcome:'unconfirmed'});} finally {await page.close();}
 }
 fs.writeFileSync('amazon-offer-check.json',JSON.stringify({results},null,2)+'\n');
 console.log(JSON.stringify({results}));
} finally {await context.close();await browser.close();}
