export async function readVisibleAccount(page,handle){
 let stage='NAVIGATE';
 try{
  // Wait for the document commit, not unrelated ads/media completing their load.
  await page.goto('https://x.com/'+handle,{waitUntil:'commit',timeout:45000});
  stage='WAIT_POSTS';const cards=page.locator('article');
  await cards.first().waitFor({state:'visible',timeout:90000});
  stage='EXPAND';let expansionIncomplete=false;
  const more=cards.getByRole('button',{name:/^(Show more|さらに表示)$/});
  for(let i=0,n=Math.min(await more.count(),8);i<n;i++){
   try{const b=more.first();if(!await b.isVisible())break;await b.click({timeout:2000});}
   catch{expansionIncomplete=true;break;}
  }
  stage='READ';
  const rows=await cards.evaluateAll(es=>es.slice(0,20).map(e=>{
   const root=e.closest('[data-href]')||e;
   return {url:root.getAttribute('data-href')||e.querySelector('a[href*="/status/"]')?.getAttribute('href'),text:e.innerText,postedAt:e.querySelector('time')?.getAttribute('datetime')||null,
    urls:[...e.querySelectorAll('a[href]')].flatMap(a=>[a.getAttribute('title'),a.getAttribute('href')]).filter(x=>x?.startsWith('https://'))};
  }));
  return {rows,expansionIncomplete};
 }catch(e){return {rows:[],error:e.name,stage};}
}
