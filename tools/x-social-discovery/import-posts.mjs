import fs from 'node:fs';
import path from 'node:path';
import {extractPostCandidates} from './normalize-links.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node import-posts.mjs posts.json output-directory [--resolve]');
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const posts = Array.isArray(raw) ? raw : raw.posts;
if (!Array.isArray(posts)) throw new Error('Input must be an array or {posts: []}');
const resolveRedirect = process.argv.includes('--resolve') ? async url => {
  const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(10000)});
  const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
  await response.body?.cancel();
  return location;
} : undefined;
const result = await extractPostCandidates(posts, {resolveRedirect});
fs.mkdirSync(output, {recursive: true});
fs.writeFileSync(path.join(output, 'x-candidates.json'), JSON.stringify(result, null, 2) + '\n');
// Candidate batch only. No public snapshot or confirmed Amazon state is written.
fs.writeFileSync(path.join(output, 'amazon-watch-candidates.json'), JSON.stringify({
  schemaVersion: 1, kind: 'POKEMON_RADAR_AMAZON_ASIN_BATCH', policy: 'candidate-only',
  urls: result.amazon.map(item => ({sourceId: 'amazon', discoverySource: 'x-social', asin: item.asin,
    url: item.canonicalUrl, priority: 90, verificationRequired: true, evidence: item.evidence}))
}, null, 2) + '\n');
console.log(JSON.stringify({amazon: result.amazon.length, official: result.official.length, review: result.review.length}));
