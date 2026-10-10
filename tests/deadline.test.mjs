import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deadlineDisplay} from '../model.mjs';
const end=Date.parse('2026-10-11T23:45:00+09:00');
const c={entryPeriod:{end:{iso:new Date(end).toISOString()}}};
test('締切日時を日本時間・年月日・時刻で表示',()=>{
 const d=deadlineDisplay(c,end-3600000);assert.match(d.dateLabel,/2026年10月11日/);assert.match(d.dateLabel,/23:45/);
});
test('日・時間で残り期間を表示',()=>{assert.equal(deadlineDisplay(c,end-26*3600000).remainingLabel,'締切まであと約1日2時間');});
test('24時間以内と1時間以内を強調',()=>{
 assert.equal(deadlineDisplay(c,end-86400000).tone,'soon');
 assert.equal(deadlineDisplay(c,end-59*60000).remainingLabel,'締切まであと約59分');
});
test('締切ちょうどと期限後は終了表示',()=>{
 for(const now of [end,end+1]){assert.equal(deadlineDisplay(c,now).tone,'closed');assert.equal(deadlineDisplay(c,now).remainingLabel,'応募締切は終了しています');}
});
test('時刻なしや不正日時を補完しない',()=>{
 assert.equal(deadlineDisplay({entryPeriod:{end:{date:'2026-10-11'}}}).dateLabel,'2026/10/11（時刻未確認）');
 assert.equal(deadlineDisplay({entryPeriod:{end:{iso:'invalid'}}}).tone,'unknown');
 assert.equal(deadlineDisplay({}).tone,'unknown');
});
test('締切欄は条件折りたたみと補足非表示から独立',()=>{
 const app=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 assert.match(app,/deadlineDisplay\(c,now\)/);
 assert.match(app,/class="deadline \$\{deadline.tone\}"/);
 assert.doesNotMatch(app,/class="deadline[^"\n]*display-supplementary/);
 const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');assert.match(css,/\.deadline\.closed \.remaining/);
});
