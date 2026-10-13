import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildXSocialTargets} from '../tools/x-social-discovery/build-targets.mjs';

const config=JSON.parse(fs.readFileSync(new URL('../data/internal/x-social-discovery-config.json',import.meta.url),'utf8'));

test('X候補発見は直接公開しない',()=>{
  const out=buildXSocialTargets(config,{generatedAt:'2026-10-14T00:00:00.000Z'});
  assert.equal(out.policy,'candidate-only');
  assert.ok(out.targets.length>=10);
  assert.ok(out.targets.every(x=>x.publishDirectly===false));
  assert.equal(out.validation.amazon.publishOnlyWhenRequestable,true);
  assert.equal(out.validation.other.allowXOnlyPublication,false);
});

test('pokecamatomeruを最優先候補源として含む',()=>{
  const out=buildXSocialTargets(config);
  const row=out.targets.find(x=>x.handle==='pokecamatomeru');
  assert.ok(row);
  assert.equal(row.priority,100);
  assert.deepEqual(row.genres,['pokemon-card']);
});

test('利益候補ジャンルを6系統に限定して検索する',()=>{
  const out=buildXSocialTargets(config);
  const searches=out.targets.filter(x=>x.type==='live-search');
  assert.equal(searches.length,6);
  assert.ok(searches.some(x=>x.genres.includes('pokemon-card')));
  assert.ok(searches.some(x=>x.genres.includes('one-piece-card')));
  assert.ok(searches.some(x=>x.genres.includes('gundam-card')));
  assert.ok(searches.some(x=>x.genres.includes('disney-lorcana')));
  assert.ok(searches.some(x=>x.genres.includes('dragon-ball-fw')));
  assert.ok(searches.some(x=>x.genres.includes('union-arena')));
});
