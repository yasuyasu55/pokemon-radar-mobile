import {decodeEntities,htmlToText} from '../otakara-dryrun/core/htmlText.mjs';

export const SEARCH_QUERIES=[
  'ポケモンカード 抽選',
  'ポケモンカード 招待',
  'ポケモン 招待販売'
];
export const MAX_DISCOVERED_ASINS=20;

const normalize=s=>htmlToText(s??'').replace(/\s+/g,' ').trim();
export function discoverAmazonAsins(html){
  const clean=html.replace(/<!--[sS]*?-->/g,' ').replace(/<(script|style|noscript|template|svg)\b[sS]*?<\/\1\s*>/gi,' ');
  const found=new Map();
  const add=(asin,label,source)=>{
    asin=String(asin??'').toUpperCase();
    if(!/^[A-Z0-9]{10}$/.test(asin))return;
    const text=normalize(label);
    if(text&&!/ポケモン|Pokemon/i.test(text))return;
    if(/オリパ|中古|福袋/.test(text))return;
    const prior=found.get(asin);
    if(!prior||prior.label.length<text.length)found.set(asin,{asin,label:text,source});
  };
  for(const m of clean.matchAll(/<div\b[^>]*\bdata-asin=["']([A-Z0-9]{10})["'][^>]*>([\s\S]*?)(?=<div\b[^>]*\bdata-asin=|$)/gi))add(m[1],m[2],'data-asin');
  for(const m of clean.matchAll(/<a\b[^>]*href=["'][^"']*\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi))add(m[1],m[2],'product-link');
  return [...found.values()];
}
export function mergeDiscovered(groups,limit=MAX_DISCOVERED_ASINS){
  const out=new Map();
  for(const group of groups)for(const item of group.items??[]){
    if(!out.has(item.asin))out.set(item.asin,{...item,queries:[group.query]});
    else if(!out.get(item.asin).queries.includes(group.query))out.get(item.asin).queries.push(group.query);
  }
  return [...out.values()].slice(0,limit);
}
export function searchUrl(query){return 'https://www.amazon.co.jp/s?k='+encodeURIComponent(query);}
