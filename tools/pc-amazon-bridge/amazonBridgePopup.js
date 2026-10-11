const amazonBridgeButton=document.getElementById('amazonBridgeButton');
const amazonBridgeStatus=document.getElementById('amazonBridgeStatus');
amazonBridgeButton.addEventListener('click',async()=>{
 amazonBridgeButton.disabled=true;amazonBridgeStatus.textContent='商品欄を確認しています…';
 try {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id)throw new Error('Amazonの商品ページを開いてください。');
  const url=new URL(tab.url);
  if(url.protocol!=='https:'||url.hostname!=='www.amazon.co.jp')throw new Error('Amazonの商品ページで押してください。');
  const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['amazonBridgeCapture.js']});
  if(!result?.result?.ok)throw new Error(result?.result?.error||'確認できませんでした。');
  const bytes=new TextEncoder().encode(JSON.stringify(result.result.capture));
  const encoded=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_');
  await chrome.tabs.create({url:'https://pokemon-radar-personal.precious-masa1997.chatgpt.site/radar/index.html#amazon-capture='+encoded});
  amazonBridgeStatus.textContent='個人用画面が開きます。「この確認結果を保存する」を押してください。';
 }catch(e){amazonBridgeStatus.textContent=e.message;}
 finally{amazonBridgeButton.disabled=false;}
});

const amazonSearchScanButton=document.getElementById('amazonSearchScanButton');
const amazonSearchScanStatus=document.getElementById('amazonSearchScanStatus');
const waitLoaded=tabId=>new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(new Error('商品ページの読み込みがタイムアウトしました。'));},20000);
 const listener=(id,info)=>{if(id===tabId&&info.status==='complete'){clearTimeout(timeout);chrome.tabs.onUpdated.removeListener(listener);resolve();}};
 chrome.tabs.onUpdated.addListener(listener);
});
amazonSearchScanButton?.addEventListener('click',async()=>{
 amazonSearchScanButton.disabled=true;amazonSearchScanStatus.textContent='検索結果から候補ASINを確認しています…';
 const opened=[];
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id)throw new Error('Amazon検索結果ページを開いてください。');
  const url=new URL(tab.url);
  if(url.protocol!=='https:'||url.hostname!=='www.amazon.co.jp'||url.pathname!=='/s')throw new Error('Amazonの検索結果ページで実行してください。');
  const [discovery]=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['amazonSearchCapture.js']});
  if(!discovery?.result?.ok)throw new Error(discovery?.result?.error||'候補ASINを確認できませんでした。');
  const captures=[],checked=[];
  for(const candidate of discovery.result.candidates){
   amazonSearchScanStatus.textContent=`候補を確認中 ${checked.length+1}/${discovery.result.candidates.length}：${candidate.title||candidate.asin}`;
   let t;
   try{
    t=await chrome.tabs.create({url:'https://www.amazon.co.jp/dp/'+candidate.asin,active:false});
    opened.push(t.id);
    await waitLoaded(t.id);
    const [result]=await chrome.scripting.executeScript({target:{tabId:t.id},files:['amazonBridgeCapture.js']});
    checked.push({asin:candidate.asin,ok:!!result?.result?.ok,error:result?.result?.error||null});
    if(result?.result?.ok)captures.push(result.result.capture);
   }catch(e){checked.push({asin:candidate.asin,ok:false,error:e.message});}
   finally{if(t?.id){try{await chrome.tabs.remove(t.id);}catch{}}}
  }
  if(!captures.length)throw new Error('候補商品を確認しましたが、招待販売として確定できる商品はありませんでした。');
  for(const capture of captures){
   const bytes=new TextEncoder().encode(JSON.stringify(capture));
   const encoded=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_');
   await chrome.tabs.create({url:'https://pokemon-radar-personal.precious-masa1997.chatgpt.site/radar/index.html#amazon-capture='+encoded});
  }
  amazonSearchScanStatus.textContent=`確認完了：${captures.length}件の招待販売候補を個人用画面へ開きました。各画面で保存してください。`;
 }catch(e){amazonSearchScanStatus.textContent=e.message;}
 finally{
  for(const id of opened){try{await chrome.tabs.remove(id);}catch{}}
  amazonSearchScanButton.disabled=false;
 }
});