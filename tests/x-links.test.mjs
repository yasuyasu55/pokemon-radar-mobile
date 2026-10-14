import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLink, extractPostCandidates} from '../tools/x-social-discovery/normalize-links.mjs';

test('Amazon affiliate URLs become canonical ASIN candidates', async () => {
  const r = await normalizeLink('https://www.amazon.co.jp/gp/product/B0GP9QHQ3Y?tag=affiliate-22&ref=ad');
  assert.equal(r.canonicalUrl, 'https://www.amazon.co.jp/dp/B0GP9QHQ3Y');
  assert.equal(r.publishDirectly, false);
  assert.equal(r.verificationRequired, true);
});
test('short link chain resolves and keeps original evidence', async () => {
  const r = await normalizeLink('https://t.co/example', {resolveRedirect: async u => u.includes('t.co') ? 'https://amzn.to/example' : 'https://www.amazon.co.jp/dp/B0GP9QHQ3Y?tag=x'});
  assert.equal(r.asin, 'B0GP9QHQ3Y');
  assert.equal(r.originalUrl, 'https://t.co/example');
});
test('untrusted redirects and spoofed hosts are not requested', async () => {
  let calls = 0;
  const r = await normalizeLink('https://t.co/example', {resolveRedirect: async () => { calls++; return 'http://127.0.0.1/private'; }});
  assert.equal(r.status, 'needs-review');
  assert.equal(calls, 1);
  for (const u of ['https://amazon.co.jp.evil.test/dp/B0GP9QHQ3Y', 'https://user@www.amazon.co.jp/dp/B0GP9QHQ3Y', 'https://www.amazon.co.jp:8443/dp/B0GP9QHQ3Y']) assert.equal((await normalizeLink(u)).status, 'needs-review');
});
test('loops and unavailable short links remain unresolved', async () => {
  assert.equal((await normalizeLink('https://t.co/x')).status, 'needs-review');
  assert.equal((await normalizeLink('https://t.co/x', {resolveRedirect: async () => 'https://t.co/x'})).reason, 'redirect-loop');
});
test('Rakuten affiliate wrapper removes tracking and preserves application parameters', async () => {
  const target = 'https://books.rakuten.co.jp/event/example?entry=123&utm_source=x&scid=af';
  const r = await normalizeLink('https://hb.afl.rakuten.co.jp/hgc/example?pc=' + encodeURIComponent(target));
  assert.equal(r.canonicalUrl, 'https://books.rakuten.co.jp/event/example?entry=123');
});
test('same ASIN deduplicates without losing account or result-notice evidence', async () => {
  const out = await extractPostCandidates([
    {handle: 'one', text: '受付開始 https://www.amazon.co.jp/dp/B0GP9QHQ3Y?tag=a'},
    {handle: 'two', text: '当選通知 https://www.amazon.co.jp/gp/product/B0GP9QHQ3Y?tag=b'}
  ]);
  assert.equal(out.amazon.length, 1);
  assert.equal(out.amazon[0].evidence.length, 2);
  assert.equal(out.amazon[0].state, 'new');
  assert.equal(out.amazon[0].publishDirectly, false);
});
