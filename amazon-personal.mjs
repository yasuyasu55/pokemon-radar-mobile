export function captureToCase(p) {
 return {id:`amazon:${p.asin}`,title:p.title,sourceName:'Amazon · PCで確認',sourceUrl:`https://www.amazon.co.jp/dp/${p.asin}`,fetchedAt:p.observedAt,
  browserCapture:true,applicationMethod:'Amazonの招待リクエスト',entryPeriod:null,receivingMethod:'UNKNOWN',stores:[],conditions:[],handoverRestrictions:[],prices:[],
  verification:'本人が保存したブラウザ確認結果（サーバーの実取得証拠ではありません）'};
}
export class AmazonPersonal {
 constructor({cloud,fetcher=fetch,onChange=()=>{}}) {this.cloud=cloud;this.fetcher=fetcher;this.onChange=onChange;this.cases=[];this.busy=false;}
 async sync() {
  if(!this.cloud||this.busy)return;this.busy=true;
  try{const r=await this.fetcher('/api/amazon-cases',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error('read');const d=await r.json();if(!Array.isArray(d.captures))throw new Error('invalid');this.cases=d.captures.map(captureToCase);this.onChange(null);}
  catch{this.onChange('Amazonの共有結果を読み込めません。表示中の情報を保持しています。');}
  finally{this.busy=false;}
 }
 async save(p){const r=await this.fetcher('/api/amazon-cases',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});if(!r.ok){let d;try{d=await r.json();}catch{}throw new Error(d?.error||'保存できませんでした。再試行してください。');}await this.sync();}
}
export function readCaptureHash(hash) {
 if(!hash.startsWith('#amazon-capture='))return null;
 if(hash.length>6000)throw new Error('送信内容が大きすぎます');
 const raw=atob(hash.slice('#amazon-capture='.length).replace(/-/g,'+').replace(/_/g,'/'));
 return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
}
