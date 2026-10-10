// 保存本文の再解析: すでに実取得した本文(bodies/*.html)を、現行の抽出器・検証で解析し直す。
// - 新しい実取得ではない。env.mode="REANALYSIS" と明記する。
// - 通信の記録(ステータス・サイズ・応答ハッシュ・取得時刻)は元の実取得のものをそのまま引き継ぐ。
// - 保存本文は伏せ字処理済みのため、本文テキストのハッシュが元と一致するかを項目ごとに記録する(一致すれば再解析は実取得の本文と同等)。
import { runPipeline } from "./pipeline.mjs";
import { sha256 } from "./http.mjs";

const bodyNameFor = (url) => {
  const u = new URL(url);
  if (u.pathname === "/robots.txt") return "robots.txt";
  if (u.pathname === "/new_information/") return "list.html";
  const m = /^\/information\/(\d+)\/?$/.exec(u.pathname);
  return m ? `otakarasouko-${m[1]}.html` : null;
};

export async function reanalyzeSavedBodies({ source, original, readBody, label = "windows-reanalysis" }) {
  const fetcher = async (url) => {
    const orig = original.ledger.find((e) => e.requestedUrl === url);
    const name = bodyNameFor(url);
    const buf = name ? readBody(name) : null;
    const base = { requestedUrl: url, finalUrl: url, startedAt: orig?.startedAt || original.startedAt, redirects: [], durationMs: 0, socket: {} };
    if (!orig || !orig.ok || !buf) return { ...base, ok: false, status: orig?.status ?? 404, errorKind: "HTTP_STATUS", error: "元の取得または保存本文がない", headers: {}, bytes: 0, sha256: null, body: null };
    return { ...base, ok: true, status: orig.status, errorKind: null, error: null, headers: { "content-type": name === "robots.txt" ? "text/plain" : "text/html; charset=utf-8" }, bytes: buf.length, sha256: sha256(buf), body: buf };
  };
  const { result } = await runPipeline({
    source, fetcher, now: new Date(original.startedAt), sleep: async () => {}, runLabel: label,
    env: { ...original.env, mode: "REANALYSIS", bodiesSaved: false, reanalysisOf: { tool: original.tool || null, runLabel: original.runLabel || null, startedAt: original.startedAt } },
  });
  // 通信の記録は元の実取得のものへ戻す(再解析で作り直した値を実取得の記録として残さない)
  const textMatch = {};
  result.ledger = result.ledger.map((e) => {
    const orig = original.ledger.find((o) => o.requestedUrl === e.requestedUrl);
    if (!orig) return e;
    textMatch[e.requestedUrl] = orig.normalizedTextSha256 ? orig.normalizedTextSha256 === e.normalizedTextSha256 : null;
    return { ...e, ...orig, normalizedTextSha256: orig.normalizedTextSha256 ?? e.normalizedTextSha256, reanalyzedNormalizedTextSha256: e.normalizedTextSha256 ?? null, originalNormalizedTextSha256: orig.normalizedTextSha256 ?? null };
  });
  result.candidates = result.candidates.map((c) => {
    const orig = original.ledger.find((o) => o.requestedUrl === c.url);
    return { ...c, fetchedAt: orig?.startedAt || c.fetchedAt, responseSha256: orig?.sha256 ?? c.responseSha256 };
  });
  result.startedAt = original.startedAt;
  result.finishedAt = original.finishedAt || original.startedAt;
  result.reanalysis = {
    kind: "SAVED_BODY_REANALYSIS", notRealFetch: true,
    original: { tool: original.tool || null, runLabel: original.runLabel || null, verdict: original.verdict, startedAt: original.startedAt, platform: original.env?.platform || null },
    normalizedTextMatchesOriginal: textMatch,
    note: "保存本文(伏せ字処理済み)を現行の抽出器で解析し直した結果。新しい実取得ではない。",
  };
  result.notes = [...result.notes, "この結果は保存本文の再解析であり、新しい実取得ではない。通信の記録は元の実取得のもの。"];
  return result;
}
