import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PersonalStore,personalMatches,favoriteCases} from '../personal.mjs';
test('独立したお気に入り一覧・解除・再読込・案件更新',async()=>{
 const memory=storage(),s=new PersonalStore({storage:memory});
 const cases=[{id:'one',title:'A'},{id:'two',title:'B'}];
 await s.toggle('one','favorite');await s.toggle('one','applied');
 assert.deepEqual(favoriteCases(cases,s.data.records),[cases[0]]);
 const reload=new PersonalStore({storage:memory});
 assert.equal(favoriteCases([{id:'one',title:'updated'}],reload.data.records)[0].title,'updated');
 await reload.toggle('one','favorite');assert.deepEqual(favoriteCases(cases,reload.data.records),[]);
 assert.equal(reload.get('one').applied,true);
});
test('検索の外にお気に入り欄があり、絞り込みを適用しない',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('id="favorites-panel"')<html.indexOf('class="search-panel"'));
 assert.doesNotMatch(html,/id="favorites-only"/);
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 assert.match(app,/favoriteCases\(snapshot.cases,personal.data.records\)/);
 assert.match(app,/\$\('favorite-cases'\).addEventListener\('click',handlePersonalClick\)/);
});
function storage(){let raw=null;return {getItem:()=>raw,setItem:(_,v)=>raw=v};}
function service(){let records={};return {get records(){return records;},fetcher:async(_,options)=>{if(options.method==='PATCH'){const p=JSON.parse(options.body);records[p.caseId]={...records[p.caseId],[p.field]:p.value,...(p.field==='applied'?{appliedAt:p.value?'2026-10-10T14:00:00Z':null}:{})};return Response.json({ok:true});}return Response.json({records:structuredClone(records)});}};}
test('お気に入りと応募済みを別保存・再読込後も保持',async()=>{const memory=storage(),s=new PersonalStore({storage:memory});await s.toggle('one','favorite');await s.toggle('one','applied');const reload=new PersonalStore({storage:memory});assert.equal(reload.get('one').favorite,true);assert.equal(reload.get('one').applied,true);await reload.toggle('one','applied');assert.equal(reload.get('one').favorite,true);assert.equal(reload.get('one').applied,false);});
test('PCで記録した内容をスマホで読込・スマホの変更をPCへ',async()=>{const api=service(),pc=new PersonalStore({cloud:true,storage:storage(),fetcher:api.fetcher}),phone=new PersonalStore({cloud:true,storage:storage(),fetcher:api.fetcher});await pc.toggle('one','applied');await phone.sync();assert.equal(phone.get('one').applied,true);await phone.toggle('one','favorite');await pc.sync();assert.equal(pc.get('one').favorite,true);assert.equal(pc.get('one').applied,true);});
test('同期失敗を成功表示せず、再起動後に保留変更を送信',async()=>{const memory=storage(),s=new PersonalStore({cloud:true,storage:memory,fetcher:async()=>{throw Error('offline');}});await s.toggle('one','applied');assert.match(s.message,/同期できていません/);assert.equal(s.get('one').applied,true);assert.ok(s.get('one').appliedAt);const api=service(),reload=new PersonalStore({cloud:true,storage:memory,fetcher:api.fetcher});await reload.sync();assert.equal(api.records.one.applied,true);assert.deepEqual(reload.data.pending,{});assert.match(reload.message,/同期済み/);});
test('途中の再クリックを消さない',async()=>{const api=service();let unblock;const gate=new Promise(r=>unblock=r);let first=true;const s=new PersonalStore({cloud:true,storage:storage(),fetcher:async(url,o)=>{if(o.method==='PATCH'&&first){first=false;await gate;}return api.fetcher(url,o);}});const running=s.toggle('one','favorite');await new Promise(r=>setTimeout(r,0));await s.toggle('one','favorite');unblock();await running;assert.equal(s.get('one').favorite,false);assert.equal(Object.keys(s.data.pending).length,1);await s.sync();assert.equal(api.records.one.favorite,false);});
test('お気に入り・未応募の積集合と未知案件',()=>{assert.equal(personalMatches({favorite:true,applied:true},{favorite:true,unapplied:true}),false);assert.equal(personalMatches({favorite:true},{favorite:true,unapplied:true}),true);assert.equal(personalMatches({}, {unapplied:true}),true);assert.equal(personalMatches({}, {favorite:true}),false);});
test('保存不可は明示する',async()=>{const s=new PersonalStore({storage:{getItem:()=>null,setItem:()=>{throw Error();}}});await s.toggle('one','favorite');assert.match(s.message,/保存できません/);});
