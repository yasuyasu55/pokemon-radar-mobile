// Runs only in the active Amazon tab after the user clicks the extension button.
// Returns selected facts; never returns HTML, cookies, account or order details.
(() => {
 const u=new URL(location.href);
 const asin=u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
 if(u.protocol!=='https:'||u.hostname!=='www.amazon.co.jp'||!asin)return {ok:false,error:'Amazonの個別商品ページで押してください。'};
 const visible=e=>{
  if(!e||!e.getClientRects().length)return false;
  for(let n=e;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||n.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}
  return true;
 };
 const titleNode=document.querySelector('span#productTitle'),root=document.querySelector('#hdp_buybox_desktop');
 const title=titleNode?.innerText?.trim().normalize('NFKC');
 if(!visible(titleNode)||!title||title.length>250||!title.includes('ポケモンカード')||/オリパ|中古|ランダム|福袋/.test(title))return {ok:false,error:'対象のポケモンカード商品名を確認できません。'};
 if(!visible(root))return {ok:false,error:'対象商品の招待販売欄を確認できません。中古出品や説明文だけでは保存しません。'};
 const notice=root.querySelector('#hdp-detail-no-requested-id'),button=root.querySelector('#hdp-invite-button'),input=button?.querySelector('input[name="submit.inviteButton"]');
 const checks={
  asinMatched:[...root.querySelectorAll('[data-csa-c-asin]')].some(e=>e.getAttribute('data-csa-c-asin')===asin),
  amazonSeller:/出荷元\s*\/\s*販売元\s*\nAmazon\.co\.jp(?:\n|$)/.test(root.innerText),
  invitationNotice:visible(notice)&&/本商品は招待販売/.test(notice.innerText),
  requestButton:visible(button)&&!!input&&!input.disabled&&/招待をリクエスト/.test(input.value)&&!button.classList.contains('a-button-disabled'),
 };
 if(!Object.values(checks).every(Boolean))return {ok:false,error:'対象商品・Amazon販売元・招待案内・リクエスト操作の確認がそろいません。受付中とは記録しません。'};
 return {ok:true,capture:{version:1,asin,title,observedAt:new Date().toISOString(),checks}};
})();
