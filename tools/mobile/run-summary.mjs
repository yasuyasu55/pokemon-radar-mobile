import fs from 'node:fs';
import path from 'node:path';
const base=process.argv[2];
console.log('# お宝創庫の更新記録');
if(!fs.existsSync(base)){console.log('取得結果を作成できませんでした。前回の公開データを保持します。');process.exit(0);}
const dir=fs.readdirSync(base).find(n=>n.startsWith('otakara-')&&fs.statSync(path.join(base,n)).isDirectory());
if(!dir){console.log('取得結果なし。前回の公開データを保持します。');process.exit(0);}
for(const n of [1,2]){
 const file=path.join(base,dir,`run-${n}/result.json`);
 if(!fs.existsSync(file)){console.log(`取得${n}: 結果なし`);continue;}
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 console.log(`\n## 取得${n}\n工程: ${r.verdict} / 抽出: ${r.extractionVerdict?.level} / 候補: ${r.counts?.candidates??'判定不能'}`);
 console.log(`一覧の除外: ${r.list?.excluded?.length??'未確認'} / 上限による未確認: ${r.list?.skippedByDetailCap?.length??'未確認'}`);
 for(const e of r.ledger??[]) console.log(`- ${e.stage}: HTTP ${e.status??'失敗'} / ${e.bytes??0} bytes / SHA-256 ${e.sha256??'なし'}`);
 for(const e of r.failures??[]) console.log(`- 失敗段階: ${e.stage} / ${e.errorKind??'不明'}`);
}
const cp=path.join(base,dir,'compare.json');
if(fs.existsSync(cp))console.log(`\n2回の比較: ${JSON.parse(fs.readFileSync(cp,'utf8')).overall}`);
console.log('\n検証・公開に失敗した場合は前回の公開データを維持します。生HTML・Cookie・通信ヘッダを公開成果物へ保存しません。');
