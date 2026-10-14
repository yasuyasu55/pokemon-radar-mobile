const shortHosts = new Set(['t.co', 'amzn.to', 'amzn.asia', 'link.amazon', 'a.r10.to']);
const officialHosts = new Set(['books.rakuten.co.jp', 'www.pokemoncenter-online.com', 't.livepocket.jp']);
function parse(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null;
  } catch { return null; }
}
function trusted(u) {
  return shortHosts.has(u.hostname) || officialHosts.has(u.hostname) ||
    ['amazon.co.jp', 'www.amazon.co.jp', 'hb.afl.rakuten.co.jp'].includes(u.hostname);
}
// resolveRedirect is supplied by the collector. It must return one Location only,
// with automatic redirects disabled; every hop is validated before requesting it.
export async function normalizeLink(originalUrl, {resolveRedirect, maxHops = 5} = {}) {
  let u = parse(originalUrl);
  const seen = new Set();
  const pending = reason => ({originalUrl, status: 'needs-review', reason, publishDirectly: false});
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!u || !trusted(u)) return pending('unsupported-destination');
    if (seen.has(u.href)) return pending('redirect-loop');
    seen.add(u.href);
    if (['amazon.co.jp', 'www.amazon.co.jp'].includes(u.hostname)) {
      const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
      if (!asin) return pending('amazon-asin-missing');
      return {originalUrl, canonicalUrl: `https://www.amazon.co.jp/dp/${asin}`, asin,
        status: 'candidate', verificationRequired: true, publishDirectly: false};
    }
    if (officialHosts.has(u.hostname)) {
      for (const key of [...u.searchParams.keys()]) {
        if (/^utm_/i.test(key) || ['scid', 'sc2id', 'gclid', 'fbclid'].includes(key.toLowerCase())) u.searchParams.delete(key);
      }
      return {originalUrl, canonicalUrl: u.href, status: 'candidate', verificationRequired: true, publishDirectly: false};
    }
    if (u.hostname === 'hb.afl.rakuten.co.jp') {
      const destination = u.searchParams.get('pc') || u.searchParams.get('m');
      if (destination) { u = parse(destination); continue; }
    }
    if (!resolveRedirect) return pending('redirect-resolution-required');
    if (hop === maxHops) return pending('redirect-limit');
    try {
      const location = await resolveRedirect(u.href);
      if (!location) return pending('redirect-unavailable');
      u = parse(new URL(location, u).href);
    } catch { return pending('redirect-failed'); }
  }
  return pending('redirect-limit');
}

export async function extractPostCandidates(posts, options = {}) {
  const amazon = new Map(), official = new Map(), review = [];
  for (const post of posts) {
    const links = new Set([...(post.urls || []), ...(String(post.text || '').match(/https:\/\/[^\s<>]+/g) || [])]);
    for (const originalUrl of links) {
      const result = await normalizeLink(originalUrl, options);
      const evidence = {handle: post.handle || null, postUrl: post.postUrl || null,
        postedAt: post.postedAt || null, originalUrl};
      if (result.status !== 'candidate') { review.push({...result, ...evidence}); continue; }
      const map = result.asin ? amazon : official;
      const key = result.asin || result.canonicalUrl;
      if (!map.has(key)) map.set(key, {...result, source: 'x-social', state: 'new', evidence: []});
      const item = map.get(key);
      if (!item.evidence.some(e => JSON.stringify(e) === JSON.stringify(evidence))) item.evidence.push(evidence);
    }
  }
  return {schemaVersion: 1, policy: 'candidate-only', amazon: [...amazon.values()], official: [...official.values()], review};
}
