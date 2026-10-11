// Runs only on an Amazon search results page after explicit user action.
// Returns visible candidate ASINs and short visible labels only. No cookies/account data/HTML leaves the page.
(() => {
 const u=new URL(location.href);
 if(u.protocol!=='https:'||u.hostname!=='www.amazon.co.jp'||u.pathname!=='/s')return {ok:false,error:'Amazonの検索結果ページで実行してください。'};
 const visible=e=>{
  if(!e||!e.getClientRects().length)return false;
  for(let n=e;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||n.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}
  return true;
 };
 const found=[];
 for(const item of document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')){
  if(!visible(item))continue;
  const asin=(item.getAttribute('data-asin')||'').toUpperCase();
  if(!/^[A-Z0-9]{10}$/.test(asin))continue;
  const titleNode=item.querySelector('h2, [data-cy="title-recipe"] h2, a h2 span, h2 span');
  const label=titleNode?.innerText?.trim()?.normalize('NFKC')||'';
  if(label&&!/ポケモン|Pokemon/i.test(label))continue;
  if(/オリパ|中古|福袋/.test(label))continue;
  if(!found.some(x=>x.asin===asin))found.push({asin,title:label.slice(0,250)});
  if(found.length>=12)break;
 }
 return found.length?{ok:true,query:u.searchParams.get('k')||'',candidates:found}:{ok:false,error:'この検索結果からポケモンカード候補ASINを確認できませんでした。'};
})();