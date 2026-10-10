let installPrompt=null;
const button=document.getElementById('install-app');
const message=document.getElementById('install-message');
const installed=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function refresh(){
 if(installed()){button.hidden=true;message.textContent='ホーム画面からアプリとして起動しています。';}
}
window.addEventListener('beforeinstallprompt',event=>{
 event.preventDefault();installPrompt=event;button.hidden=false;
});
button.addEventListener('click',async()=>{
 if(!installPrompt)return;
 const prompt=installPrompt;installPrompt=null;button.hidden=true;
 try{await prompt.prompt();await prompt.userChoice;}catch{message.textContent='ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。';}
});
window.addEventListener('appinstalled',()=>{installPrompt=null;button.hidden=true;message.textContent='追加しました。ホーム画面のアイコンから開けます。';});
refresh();
