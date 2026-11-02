const {chromium}=require('playwright');
const fs=require('fs');const path=require('path');const assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const requests=[];let fail=false;
 await context.route('https://radar.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/data/snapshot.json'){requests.push(pathname);if(fail)return route.fulfill({status:503,body:'unavailable'});}
  const file=path.join(__dirname,'..',pathname==='/'?'index.html':pathname);
  if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
  await route.fulfill({status:200,contentType:file.endsWith('.mjs')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
 });
 await page.clock.install();
 await page.goto('https://radar.test/');await page.waitForFunction(()=>document.querySelector('#refresh-results')?.disabled===false&&document.querySelector('#count')?.textContent.includes('件'));
 assert.equal(requests.length,1);
 const original=await page.locator('#cases').innerHTML();
 await page.clock.fastForward(600000);
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 assert.equal(requests.length,1,'idle and visibility must not refetch');
 assert.equal(await page.locator('#cases').innerHTML(),original,'idle must not redraw');
 const favorite=page.locator('#cases button[data-personal="favorite"]').first();
 if(await favorite.count()){await favorite.click();assert.equal(requests.length,1);assert.ok(Number(await page.locator('#favorite-count').textContent())>0);}
 await page.click('#refresh-results');await page.waitForFunction(()=>!document.querySelector('#refresh-results').disabled);assert.equal(requests.length,2);
 const before=await page.locator('#cases').innerHTML();fail=true;
 await page.click('#refresh-results');await page.waitForFunction(()=>!document.querySelector('#refresh-results').disabled);
 assert.equal(await page.locator('#cases').innerHTML(),before);assert.match(await page.locator('#viewer-status').textContent(),/前回の結果/);
 assert.deepEqual(errors,[]);console.log('PASS: mobile boot, 10-minute idle, visibility, local favorite, explicit refresh, failed refresh retention, no page errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
