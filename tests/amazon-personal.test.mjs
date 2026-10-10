import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {AmazonPersonal,captureToCase,readCaptureHash} from '../amazon-personal.mjs';import {favoriteCases} from '../personal.mjs';
const p={version:1,asin:'B0FSJXSPPX',title:'ポケモンカードゲーム ムニキスゼロ BOX',observedAt:'2026-10-10T16:00:00Z',checks:{asinMatched:true,amazonSeller:true,invitationNotice:true,requestButton:true}};
test('公開画面では個人のAmazon APIを呼ばない',async()=>{const s=new AmazonPersonal({cloud:false,fetcher:()=>{throw Error('private data');}});await s.sync();assert.deepEqual(s.cases,[]);});
test('PC結果の読込・失敗時保持・明示的保存',async()=>{let fail=false,posted;const s=new AmazonPersonal({cloud:true,fetcher:async(_,o)=>{if(fail)return new Response('',{status:503});if(o.method==='POST'){posted=JSON.parse(o.body);return Response.json({ok:true});}return Response.json({captures:[p]});}});await s.save(p);assert.deepEqual(posted,p);assert.equal(s.cases[0].id,'amazon:B0FSJXSPPX');fail=true;await s.sync();assert.equal(s.cases.length,1);await assert.rejects(()=>s.save(p));});
test('ブラウザ確認は締切・受取方法・応募済みに推測変換しない',()=>{const c=captureToCase(p);assert.equal(c.entryPeriod,null);assert.equal(c.receivingMethod,'UNKNOWN');assert.equal('applied' in c,false);assert.equal(c.browserCapture,true);assert.deepEqual(favoriteCases([c],{[c.id]:{favorite:true}}),[c]);});
test('日本語フラグメントを読め、他のhashは無視する',()=>{const h='#amazon-capture='+Buffer.from(JSON.stringify(p)).toString('base64url');assert.deepEqual(readCaptureHash(h),p);assert.equal(readCaptureHash('#other'),null);assert.throws(()=>readCaptureHash('#amazon-capture='+'.'.repeat(7000)));});

// Mock DOM scope tests. These are not Windows/real browser success evidence.
const script=readFileSync(new URL('../tools/pc-amazon-bridge/amazonBridgeCapture.js',import.meta.url),'utf8');
function dom({used=false,hidden=false,seller='Amazon.co.jp',disabled=false,linked='B0FSJXSPPX',invitation=true}={}){
 const node=text=>({nodeType:1,innerText:text,parentElement:null,hidden:false,getAttribute:()=>null,getClientRects:()=>[{}]});
 const title=node(p.title),notice=node(invitation?'本商品は招待販売としております。':'通常販売'),button=node('招待をリクエストする');
 button.classList={contains:()=>false};button.querySelector=()=>({disabled,value:'招待をリクエストする'});button.hidden=hidden;
 const root=node(`出荷元 / 販売元\n${seller}`);root.querySelector=s=>s==='#hdp-detail-no-requested-id'?notice:s==='#hdp-invite-button'?button:null;root.querySelectorAll=()=>[{getAttribute:()=>linked}];
 return {querySelector:s=>s==='span#productTitle'?title:s==='#hdp_buybox_desktop'&&!used?root:null};
}
const execute=(options,url='https://www.amazon.co.jp/gp/product/B0FSJXSPPX')=>vm.runInNewContext(script,{document:dom(options),location:{href:url},URL,Date,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})});
test('対象商品の可視購入欄だけを共有し、個人情報を返さない',()=>{const r=execute();assert.equal(r.ok,true);assert.equal(r.capture.asin,p.asin);assert.deepEqual(Object.keys(r.capture).sort(),['asin','checks','observedAt','title','version']);});
test('中古欄・隠しボタン・第三者販売元・無効操作・別ASINを拒否',()=>{for(const o of [{used:true},{hidden:true},{seller:'他店'},{disabled:true},{linked:'B0F18J2CJF'},{invitation:false}])assert.equal(execute(o).ok,false);});
test('Amazonの検索・他サイトでは動作しない',()=>{for(const url of ['https://www.amazon.co.jp/s?k=pokemon','https://evil.example/dp/B0FSJXSPPX'])assert.equal(execute({},url).ok,false);});
test('PC側は既存の権限だけで、個人用画面へ限定した情報を送る',()=>{const popup=readFileSync(new URL('../tools/pc-amazon-bridge/amazonBridgePopup.js',import.meta.url),'utf8');assert.match(popup,/active:true,currentWindow:true/);assert.match(popup,/pokemon-radar-personal/);assert.doesNotMatch(popup,/cookies\.|document\.cookie|fetch\(|innerHTML/);});
