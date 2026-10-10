import { runnerLabelOf } from "./status.mjs";
// 2回の独立した取得結果の比較。応答のハッシュが違うだけでは失敗扱いにせず、本文テキスト・抽出内容の差も見る。
const CACHE_HEADERS = ["age", "x-cache", "cf-cache-status", "etag", "last-modified", "cache-control", "date"];

function canon(v) { return JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x)); }

export function compareRuns(a, b) {
  const urls = [...new Set([...a.ledger, ...b.ledger].map((e) => e.requestedUrl))];
  const rows = [];
  for (const url of urls) {
    const ea = a.ledger.find((e) => e.requestedUrl === url);
    const eb = b.ledger.find((e) => e.requestedUrl === url);
    let cls;
    let detail = "";
    if (!ea || !eb) { cls = "MISSING_IN_ONE_RUN"; detail = ea ? "2回目に該当リクエストなし" : "1回目に該当リクエストなし"; }
    else if (!ea.ok && !eb.ok) { cls = "BOTH_FAILED"; detail = `${ea.errorKind || ea.status} / ${eb.errorKind || eb.status}`; }
    else if (ea.ok !== eb.ok) { cls = "ONE_RUN_FAILED"; detail = `1回目 ${ea.ok ? "成功" : ea.errorKind || ea.status} / 2回目 ${eb.ok ? "成功" : eb.errorKind || eb.status}`; }
    else if (ea.sha256 === eb.sha256) { cls = "IDENTICAL_RESPONSE"; }
    else if (ea.normalizedTextSha256 && ea.normalizedTextSha256 === eb.normalizedTextSha256) { cls = "DIFF_BYTES_SAME_TEXT"; detail = "バイト列は違うが、本文テキストは同一(動的な属性等の差)"; }
    else {
      const ca = a.candidates.find((c) => c.url === url);
      const cb = b.candidates.find((c) => c.url === url);
      if (ca && cb && canon(ca.fields) === canon(cb.fields)) { cls = "DIFF_TEXT_SAME_EXTRACTION"; detail = "本文は違うが、抽出した案件情報は同一"; }
      else if (ca && cb) { cls = "EXTRACTION_CHANGED"; detail = "抽出した案件情報が違う(取得の間に記事が更新された可能性、または取得の揺れ)"; }
      else { cls = "TEXT_CHANGED_NOT_COMPARABLE"; detail = "本文が違い、案件としての抽出比較はできない(一覧ページ等)"; }
    }
    const cache = (e) => (e ? Object.fromEntries(CACHE_HEADERS.filter((h) => e.headers && e.headers[h] !== undefined).map((h) => [h, e.headers[h]])) : null);
    rows.push({
      url, stage: (ea || eb)?.stage, classification: cls, detail,
      run1: ea ? { ok: ea.ok, status: ea.status, bytes: ea.bytes, sha256: ea.sha256, localPort: ea.socket?.localPort ?? null, remoteAddress: ea.socket?.remoteAddress ?? null, cache: cache(ea) } : null,
      run2: eb ? { ok: eb.ok, status: eb.status, bytes: eb.bytes, sha256: eb.sha256, localPort: eb.socket?.localPort ?? null, remoteAddress: eb.socket?.remoteAddress ?? null, cache: cache(eb) } : null,
    });
  }
  const candA = new Set(a.candidates.map((c) => c.url));
  const candB = new Set(b.candidates.map((c) => c.url));
  const onlyA = [...candA].filter((u) => !candB.has(u));
  const onlyB = [...candB].filter((u) => !candA.has(u));
  const independence = {
    sameProcess: a.env?.pid != null && a.env?.pid === b.env?.pid,
    pids: [a.env?.pid ?? null, b.env?.pid ?? null],
    processStartedAt: [a.env?.processStartedAt ?? null, b.env?.processStartedAt ?? null],
    startedAt: [a.startedAt, b.startedAt],
    // 同じURLで、ローカルポートが毎回違えば、接続を使い回していない裏付けになる
    localPortsDifferForSameUrl: rows.filter((r) => r.run1?.localPort && r.run2?.localPort).every((r) => r.run1.localPort !== r.run2.localPort),
    note: "取得はそれぞれ別のプロセス・新しい接続(keepAliveなし)・Cookieなし・Cache-Control: no-cache。保存HTMLやファイルキャッシュは使っていない",
  };
  const bad = rows.filter((r) => ["BOTH_FAILED", "ONE_RUN_FAILED", "MISSING_IN_ONE_RUN", "EXTRACTION_CHANGED", "TEXT_CHANGED_NOT_COMPARABLE"].includes(r.classification));
  const overall = a.verdict !== b.verdict ? "VERDICT_DIFFERS" : bad.length === 0 && onlyA.length === 0 && onlyB.length === 0 ? "CONSISTENT" : "DIFFERENCES";
  return { schemaVersion: "otakara-dryrun-compare/1", overall, verdicts: [a.verdict, b.verdict], rows, candidatesOnlyInRun1: onlyA, candidatesOnlyInRun2: onlyB, independence };
}

// ---- 環境間の比較(Windows と GitHub Actions など) -----------------------------------------
// 応答ハッシュの一致は必須にしない。『本文(正規化テキスト)の変更』と『抽出結果の差』を分けて分類する。
function flatten(v, prefix = "", out = {}) {
  if (v !== null && typeof v === "object") {
    const keys = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v).sort();
    if (keys.length === 0) out[prefix] = Array.isArray(v) ? [] : {};
    for (const k of keys) flatten(v[k], prefix ? `${prefix}${Array.isArray(v) ? `[${k}]` : `.${k}`}` : String(k), out);
  } else out[prefix] = v;
  return out;
}
const EVIDENCE_PATH = /(^|\.)(evidence|notes|sectionLines|quote)(\.|\[|$)/;

export function diffFields(fa, fb) {
  const A = flatten(fa), B = flatten(fb);
  const paths = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  const diffs = [];
  for (const p of paths) {
    if (JSON.stringify(A[p]) === JSON.stringify(B[p])) continue;
    diffs.push({ path: p, a: A[p] === undefined ? null : A[p], b: B[p] === undefined ? null : B[p], kind: EVIDENCE_PATH.test(p) ? "EVIDENCE_ONLY" : "VALUE" });
  }
  return diffs;
}

export function compareEnvironments(a, b) {
  const sameExtractor = (a.extractorVersion || "1") === (b.extractorVersion || "1");
  const urls = [...new Set([...a.ledger, ...b.ledger].map((e) => e.requestedUrl))];
  const rows = [];
  for (const url of urls) {
    const ea = a.ledger.find((e) => e.requestedUrl === url);
    const eb = b.ledger.find((e) => e.requestedUrl === url);
    const base = { url, stage: (ea || eb)?.stage, fetchedAt: [ea?.startedAt || null, eb?.startedAt || null], fieldDiffs: [] };
    if (!ea || !eb) { rows.push({ ...base, classification: "MISSING_IN_ONE", detail: ea ? "B側に該当リクエストなし" : "A側に該当リクエストなし" }); continue; }
    if (!ea.ok && !eb.ok) { rows.push({ ...base, classification: "BOTH_FAILED", detail: `${ea.errorKind || ea.status} / ${eb.errorKind || eb.status}` }); continue; }
    if (ea.ok !== eb.ok) { rows.push({ ...base, classification: "ONE_SIDE_FAILED", detail: `A ${ea.ok ? "成功" : ea.errorKind || ea.status} / B ${eb.ok ? "成功" : eb.errorKind || eb.status}` }); continue; }
    if (ea.sha256 && ea.sha256 === eb.sha256) { rows.push({ ...base, classification: "IDENTICAL_RESPONSE" }); continue; }
    const textSame = !!(ea.normalizedTextSha256 && ea.normalizedTextSha256 === eb.normalizedTextSha256);
    const ca = a.candidates.find((c) => c.url === url);
    const cb = b.candidates.find((c) => c.url === url);
    if (textSame && !ca && !cb) { rows.push({ ...base, classification: "SAME_TEXT_DIFF_BYTES" }); continue; }
    if (!ca || !cb) { rows.push({ ...base, classification: textSame ? "SAME_TEXT_DIFF_BYTES" : "TEXT_CHANGED_NO_CANDIDATE" }); continue; }
    if (!sameExtractor) { rows.push({ ...base, classification: textSame ? "SAME_TEXT_EXTRACTION_NOT_COMPARED" : "TEXT_CHANGED_EXTRACTION_NOT_COMPARED" }); continue; }
    const diffs = diffFields(ca.fields, cb.fields);
    const valueDiffs = diffs.filter((d) => d.kind === "VALUE");
    if (textSame) rows.push({ ...base, classification: diffs.length === 0 ? "SAME_TEXT_DIFF_BYTES" : "SAME_TEXT_EXTRACTION_DIFFERS", fieldDiffs: diffs });
    else rows.push({ ...base, classification: valueDiffs.length === 0 ? "TEXT_CHANGED_EXTRACTION_SAME" : "TEXT_CHANGED_EXTRACTION_CHANGED", fieldDiffs: diffs });
  }
  const failing = rows.filter((r) => ["BOTH_FAILED", "ONE_SIDE_FAILED", "MISSING_IN_ONE"].includes(r.classification));
  const review = rows.filter((r) => r.classification === "SAME_TEXT_EXTRACTION_DIFFERS");
  const explained = rows.filter((r) => ["TEXT_CHANGED_EXTRACTION_SAME", "TEXT_CHANGED_EXTRACTION_CHANGED", "TEXT_CHANGED_EXTRACTION_NOT_COMPARED", "TEXT_CHANGED_NO_CANDIDATE"].includes(r.classification));
  let overall, overallDetail;
  if (failing.length) { overall = "FETCH_DIFFERS"; overallDetail = "片方の環境で取得に失敗している、または対象が揃っていない"; }
  else if (review.length) { overall = "NEEDS_REVIEW"; overallDetail = "本文が同じなのに抽出結果が違う項目がある(抽出処理の問題の疑い)"; }
  else if (explained.length) { overall = "TEXT_CHANGES_EXPLAINED"; overallDetail = "本文が変わった項目がある。取得時刻の差による記事更新などで説明できるか、行ごとの分類を確認する"; }
  else { overall = "CONSISTENT"; overallDetail = "本文・抽出結果とも一致(ハッシュの差は本文の変更ではない)"; }
  const lab = (r) => ({ label: runnerLabelOf(r), tool: r.tool || "不明", verdict: r.verdict, extraction: r.extractionVerdict ? r.extractionVerdict.level : "未評価" });
  return {
    schemaVersion: "otakara-dryrun-cross-env/1", overall, overallDetail, a: lab(a), b: lab(b),
    extractionComparable: sameExtractor,
    extractionNote: sameExtractor ? null : `抽出器の版が違う(A: ${a.extractorVersion || "旧版"} / B: ${b.extractorVersion || "旧版"})。本文ハッシュだけを比較した`,
    rows,
  };
}
