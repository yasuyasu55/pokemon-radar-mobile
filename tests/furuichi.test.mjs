import test from 'node:test';
import assert from 'node:assert/strict';
import {discover,ENTRYPOINTS} from '../tools/furuichi/collect.mjs';

test('ふるいち公式の複数入口を持つ',()=>{
  assert.equal(ENTRYPOINTS.length,3);
  assert.ok(ENTRYPOINTS.some(x=>x.endsWith('/')));
  assert.ok(ENTRYPOINTS.some(x=>x.includes('news.html')));
  assert.ok(ENTRYPOINTS.some(x=>x.includes('news_information.html')));
});

test('ポケカ抽選記事だけを候補化し、中止記事は除外',()=>{
  const html=[
    '<a href="/news/news_information/pokemon-lottery">ポケモンカードゲーム MEGA カードセット抽選受付について</a>',
    '<a href="/news/news_information/cancel">ポケモンカードゲーム 抽選販売 中止のお知らせ</a>',
    '<a href="/news/news_campaign/game">ゲームソフト抽選販売</a>'
  ].join('');
  const rows=discover(html,'https://www.furu1.net/');
  assert.equal(rows.length,1);
  assert.match(rows[0].title,/ポケモンカードゲーム/);
  assert.match(rows[0].url,/furu1\.net\/news\//);
});
