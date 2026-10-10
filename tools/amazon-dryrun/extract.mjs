import {htmlToText, decodeEntities} from '../otakara-dryrun/core/htmlText.mjs';

// This deliberately supports only the observed desktop offer structure.
// A layout change is UNKNOWN, never proof that invitation sales ended.
export const EXTRACTOR_VERSION = 'amazon-probe-0.1.0';
export const TARGETS = ['B0FSJXSPPX', 'B0F18J2CJF'];
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decodeEntities(m[2]??m[3])]));

function elements(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi,'');
  const stack=[], out=[];
  for(const m of clean.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag=m[1].toLowerCase(), closing=m[0].startsWith('</');
    if(closing) {
      const i=stack.findLastIndex(n=>n.tag===tag);
      if(i<0) continue;
      for(const n of stack.splice(i)) {n.end=m.index+m[0].length;n.html=clean.slice(n.start,n.end);out.push(n);}
    } else {
      const a=attrs(m[0]);
      const hidden=stack.some(n=>n.hidden)||/\bhidden(?:\s|=|>)/i.test(m[0])||a['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style??'')||/(?:^|\s)aok-hidden(?:\s|$)/.test(a.class??'');
      const n={tag,attrs:a,hidden,start:m.index,end:m.index+m[0].length,html:m[0]};
      if(VOID.has(tag)||m[0].endsWith('/>'))out.push(n);else stack.push(n);
    }
  }
  return out;
}
function byId(nodes,id) {return nodes.find(n=>n.attrs.id===id&&!n.hidden);}
function visibleText(fragment) {
  // Do not accept a hidden seller or a hidden success-message template.
  const hidden=elements(fragment).filter(n=>n.hidden).sort((a,b)=>b.start-a.start);
  let s=fragment;
  // Remove only outermost hidden ranges, avoiding overlapping replacements.
  const ranges=hidden.filter(n=>!hidden.some(p=>p!==n&&p.start<n.start&&p.end>=n.end));
  for(const n of ranges)s=s.slice(0,n.start)+s.slice(n.end);
  return htmlToText(s);
}

export function extractAmazon(html,asin) {
  if(!/^[A-Z0-9]{10}$/.test(asin))throw new Error('Invalid ASIN');
  const nodes=elements(html);
  const titleNode=nodes.find(n=>n.attrs.id==='productTitle'&&n.tag==='span'&&!n.hidden);
  const title=titleNode?visibleText(titleNode.html):null;
  const base={id:`amazon:${asin}`,asin,url:`https://www.amazon.co.jp/dp/${asin}`,title,kind:'UNKNOWN',requestStatus:'UNKNOWN',candidate:false,
    deadline:null,resultDate:null,receivingMethod:'UNKNOWN',evidence:[],unknowns:['応募締切','当選通知日時','配送・受取条件','本人のリクエスト状況'],extractorVersion:EXTRACTOR_VERSION};
  if(!title) return {...base,reason:'商品名を確認できない応答（エラー画面・構造変更を含む）'};
  if(!/ポケモンカード/.test(title)||/オリパ|中古|ランダム|福袋/.test(title))return {...base,kind:'REFERENCE',reason:'対象の商品名ではありません'};
  const box=byId(nodes,'hdp_buybox_desktop');
  if(!box)return {...base,reason:byId(nodes,'used_buybox_desktop')?'現在取得した購入欄は中古出品。説明文だけでは招待受付を確認できません':'対象商品の招待販売欄を確認できません'};
  const bn=elements(box.html), text=visibleText(box.html);
  const linked=bn.some(n=>!n.hidden&&n.attrs['data-csa-c-asin']===asin);
  const statement=byId(bn,'hdp-detail-no-requested-id');
  const message=statement?visibleText(statement.html):'';
  const button=byId(bn,'hdp-invite-button');
  const input=button?elements(button.html).find(n=>n.tag==='input'&&n.attrs.name==='submit.inviteButton'&&!n.hidden):null;
  const enabled=input&&!/\bdisabled(?:\s|=|>)/i.test(input.html)&&!/a-button-disabled/.test(button.attrs.class??'');
  const seller=/出荷元\s*\/\s*販売元\s*\nAmazon\.co\.jp(?:\n|$)/.test(text);
  const invite=/本商品は招待販売/.test(message);
  if(!(linked&&seller&&invite&&enabled&&/招待をリクエスト/.test(input.attrs.value??'')))return {...base,reason:'商品との紐づけ・Amazon販売元・招待案内・有効なリクエスト操作のいずれかが未確認'};
  return {...base,kind:'INVITATION_SALE',requestStatus:'REQUEST_CONTROL_PRESENT',candidate:true,
    reason:'対象商品のAmazon販売欄に招待販売案内とリクエスト操作があります（本人の応募可否は公式画面で確認）',
    evidence:[{scope:'hdp_buybox_desktop',fact:'対象ASINとの紐づけ',value:asin},{scope:'hdp-detail-no-requested-id',fact:'招待販売',value:message.slice(0,180)},{scope:'hdp-invite-button',fact:'リクエスト操作',value:input.attrs.value},{scope:'hdp_buybox_desktop',fact:'出荷元・販売元',value:'Amazon.co.jp'}]};
}
