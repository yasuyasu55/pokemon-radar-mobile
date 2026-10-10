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
