// Normal public-page acquisition only. A sign-in wall is a failure, never 0 posts.
export async function collectPublicPosts(handles) {
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
  const posts=[],accounts=[];
  try {
    for(const handle of handles) {
      const page=await context.newPage();
      try {
        const response=await page.goto('https://x.com/'+handle,{waitUntil:'domcontentloaded',timeout:25000});
        await page.waitForTimeout(2500);
        if(response?.status()!==200) {accounts.push({handle,outcome:'fetch-failed',status:response?.status()});continue;}
        const seen=new Map();
        for(let n=0;n<3;n++) {
          const found=await page.locator('article[data-testid="tweet"]').evaluateAll(nodes=>nodes.map(article=>{
            const time=article.querySelector('time');
            const url=time?.closest('a')?.getAttribute('href');
            return {postUrl:url,postedAt:time?.getAttribute('datetime'),text:article.querySelector('[data-testid="tweetText"]')?.textContent || '',
              urls:[...article.querySelectorAll('[data-testid="tweetText"] a[href]')].map(a=>a.getAttribute('href'))};
          }));
          for(const p of found) {
            const m=p.postUrl?.match(/^\/([^/]+)\/status\/(\d+)$/);
            if(m && m[1].toLowerCase()===handle.toLowerCase()) seen.set(m[2],{...p,handle,postId:m[2],postUrl:'https://x.com'+p.postUrl});
          }
          if(!found.length) break;
          await page.mouse.wheel(0,1200);await page.waitForTimeout(1000);
        }
        posts.push(...seen.values());
        accounts.push({handle,outcome:seen.size?'public-sample':'blocked-or-unavailable',posts:seen.size,coverage:'visible timeline sample only'});
      } catch {accounts.push({handle,outcome:'fetch-failed'});} finally {await page.close();}
    }
    return {posts,accounts};
  } finally {await context.close();await browser.close();}
}
