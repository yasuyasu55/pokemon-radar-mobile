// 取得 → 抽出 → 検証 → 候補JSON を、工程ごとに分けて通す。
// - 取得関数(fetcher)・待機(sleep)・時刻(now)は注入する(テストでも、GitHub Actionsでも、PCのダブルクリックでも同じ処理を使う)
// - 本番DB・既存の巡回・アプリのコードには一切触れない(このフォルダだけで完結)
// - 失敗を「案件0件」として扱わない: 失敗時は counts.candidates=null とし、verdict に失敗の段階を残す
import { sha256, parseRobots, isPathAllowed } from "./http.mjs";
import { decodeBody, htmlToText } from "./htmlText.mjs";
import { parseListPage, classifyListItem, extractNotice } from "./extract.mjs";
import { verifyCandidate, phaseOf, assessCompleteness } from "./verify.mjs";
import { maskSensitive } from "./mask.mjs";
import { TOOL_ID, EXTRACTOR_VERSION } from "./status.mjs";

export const SCHEMA_VERSION = "otakara-dryrun-candidates/1";
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function looksBlocked(text) {
  return text.length < 1200 && /(access denied|forbidden|captcha|just a moment|attention required|ご利用いただけません|アクセスが制限)/i.test(text);
}

function idOf(url) {
  const m = /\/information\/(\d+)\//.exec(url);
  return m ? `otakarasouko:${m[1]}` : `otakarasouko:${sha256(Buffer.from(url)).slice(0, 12)}`;
}

function labelsFor(ex) {
  const em = ex.entryMethod;
  const entryMethodLabel = em.status !== "CONFIRMED" ? "未確認" : [em.methods.includes("APP") ? `公式アプリ${em.appName ? `(${em.appName})` : ""}` : null, em.methods.includes("WEB") ? "Web応募" : null, em.methods.includes("STORE") ? "店頭" : null].filter(Boolean).join(" + ");
  const receivingLabel = ex.receiving.method === "STORE_ONLY" ? "店頭受取のみ(郵送・配送なし)" : ex.receiving.method === "STORE" ? "店頭受取(配送の可否は記載から確認できない)" : "未確認";
  const st = ex.selectableStores;
  const storesLabel = st.status === "CONFIRMED"
    ? `選択可能店舗 ${st.stores.length}店${st.selection.status === "CONFIRMED" ? "(応募時に選択)" : "(選択方法は未確認)"}`
    : "店舗一覧は未確認";
  return {
    entryMethodLabel,
    webEntryUrlLabel: em.webEntryUrlStatus,
    receivingLabel,
    storesLabel,
    requiredStoreLabel: ex.requiredStore.status === "CONFIRMED" ? `受取必須店舗: ${ex.requiredStore.value}` : "受取必須店舗: なし/未確認(選択可能店舗とは別)",
    userEligibilityLabel: ex.eligibilityConditions.userEligibility,
  };
}

function ledgerEntry(seq, stage, r, extra = {}) {
  return {
    seq, stage, requestedUrl: r.requestedUrl, finalUrl: r.finalUrl, startedAt: r.startedAt, durationMs: r.durationMs,
    ok: r.ok, status: r.status, errorKind: r.errorKind, error: r.error, bytes: r.bytes, sha256: r.sha256,
    headers: r.headers, redirects: r.redirects,
    socket: { remoteAddress: r.socket?.remoteAddress ?? null, localPort: r.socket?.localPort ?? null },
    ...extra,
  };
}

export async function runPipeline({ source, fetcher, now = new Date(), sleep = defaultSleep, runLabel = "run", env = {} }) {
  const startedAt = now.toISOString();
  const itemPathRe = new RegExp(source.itemPathPattern);
  const ledger = [];
  const bodies = {}; // 保存名 -> マスク済みテキスト
  const failures = [];
  const stages = [];
  let seq = 0;
  const summarizeExtraction = (cands, n) => {
    if (n === null || n === undefined || !cands) return { level: "NOT_EVALUATED", detail: "取得または一覧解析が完了せず、抽出の完全性は評価していない" };
    if (cands.length === 0) return { level: "NO_CANDIDATE", detail: "評価対象の候補なし" };
    const inc = cands.filter((c) => c.completeness.level !== "COMPLETE");
    return inc.length === 0 ? { level: "COMPLETE", detail: `候補${cands.length}件とも必須項目を確定`, incompleteCandidates: 0 }
      : { level: "INCOMPLETE", detail: `候補${cands.length}件中${inc.length}件に未確認の必須項目あり`, incompleteCandidates: inc.length, missing: [...new Set(inc.flatMap((c) => c.completeness.missing))] };
  };
  const finish = (verdict, detail, extra = {}) => {
    const result = {
      schemaVersion: SCHEMA_VERSION, tool: TOOL_ID, extractorVersion: EXTRACTOR_VERSION, runLabel, source: { sourceId: source.sourceId, displayName: source.displayName, listUrl: source.listUrl },
      startedAt, finishedAt: new Date().toISOString(), env, verdict, verdictDetail: detail,
      extractionVerdict: summarizeExtraction(extra.candidates, extra.candidatesCount),
      stages, ledger, failures,
      list: extra.list || null,
      candidates: extra.candidates || [],
      counts: { candidates: extra.candidatesCount ?? null, detailAttempted: extra.detailAttempted ?? 0, detailFailed: extra.detailFailed ?? 0 },
      notes: [
        "fetchedAtは本ツールが実際に通常HTTPで取得した時刻。候補JSONは本番DBへ自動採用しない。",
        "candidates=null は『0件』ではなく『判定できなかった』を意味する。",
      ],
    };
    return { result, bodies };
  };

  // ---- 工程1: robots.txt ----
  const rob = await fetcher(source.robotsUrl);
  ledger.push(ledgerEntry(++seq, "robots", rob));
  let robots = null;
  if (rob.ok && rob.body) {
    const dec = decodeBody(rob.body, rob.headers["content-type"]);
    robots = parseRobots(dec.text, "PokemonRadarDryRun");
    bodies["robots.txt"] = maskSensitive(dec.text);
    stages.push({ name: "robots", ok: true, detail: `ルール${robots.rules.length}件・crawlDelay=${robots.crawlDelay}` });
  } else if (rob.status === 404) {
    robots = { rules: [], crawlDelay: null };
    stages.push({ name: "robots", ok: true, detail: "robots.txtは404(制限なしとして扱う)" });
  } else {
    stages.push({ name: "robots", ok: false, detail: `robots.txtを読めない(${rob.errorKind || "?"} ${rob.error || ""})` });
    failures.push({ stage: "robots", url: source.robotsUrl, errorKind: rob.errorKind, status: rob.status, error: rob.error });
    return finish("ROBOTS_UNREADABLE", "robots.txtを確認できないため、安全側で以降の取得をしなかった(案件0件ではない)");
  }
  const listPath = new URL(source.listUrl).pathname;
  if (!isPathAllowed(robots, listPath)) {
    stages.push({ name: "robots-check", ok: false, detail: `${listPath} はrobots.txtで禁止` });
    return finish("ROBOTS_DISALLOWED", `${listPath} がrobots.txtで禁止されているため取得しなかった(案件0件ではない)`);
  }
  const sampleItemPath = "/information/1/";
  const detailAllowed = isPathAllowed(robots, sampleItemPath);

  // ---- 工程2: 一覧の取得 ----
  await sleep(source.limits.delayMs);
  const list = await fetcher(source.listUrl);
  const listLedger = ledgerEntry(++seq, "list", list);
  ledger.push(listLedger);
  if (!list.ok || !list.body) {
    stages.push({ name: "list-fetch", ok: false, detail: `${list.errorKind || "?"} ${list.error || ""}` });
    failures.push({ stage: "list-fetch", url: source.listUrl, errorKind: list.errorKind, status: list.status, error: list.error });
    return finish("LIST_FETCH_FAILED", "一覧ページを取得できなかった(案件0件ではない)");
  }
  const dec = decodeBody(list.body, list.headers["content-type"]);
  const listText = htmlToText(dec.text);
  listLedger.normalizedTextSha256 = sha256(Buffer.from(listText));
  listLedger.charset = dec.charset;
  bodies["list.html"] = maskSensitive(dec.text);
  bodies["list.txt"] = maskSensitive(listText);
  if (looksBlocked(listText)) {
    stages.push({ name: "list-fetch", ok: false, detail: "HTTP成功だが、アクセス拒否・確認画面らしい短い本文" });
    failures.push({ stage: "list-fetch", url: source.listUrl, errorKind: "BLOCKED_PAGE", status: list.status, error: "アクセス拒否・確認画面の疑い" });
    return finish("LIST_BLOCKED_PAGE", "一覧がアクセス拒否・確認画面の疑い。回避せず終了(案件0件ではない)");
  }
  stages.push({ name: "list-fetch", ok: true, detail: `HTTP ${list.status} ${list.bytes}バイト` });

  // ---- 工程3: 一覧の解析 ----
  const items = parseListPage(dec.text, source.listUrl, itemPathRe);
  const classified = items.map((it) => ({ ...it, ...classifyListItem(it, source.rules) }));
  const targets = classified.filter((c) => c.fetch).slice(0, source.limits.maxDetailPages);
  const skippedByCap = classified.filter((c) => c.fetch).slice(source.limits.maxDetailPages);
  const listSummary = {
    url: source.listUrl,
    itemsParsed: items.length,
    lotteryTitled: classified.filter((c) => c.fetch || /抽選/.test(c.title)).length,
    targets: targets.map((t) => ({ url: t.url, title: t.title, date: t.date })),
    excluded: classified.filter((c) => !c.fetch).map((c) => ({ url: c.url, title: c.title, date: c.date, reason: c.reason })),
    skippedByDetailCap: skippedByCap.map((c) => ({ url: c.url, title: c.title })),
    detailPathAllowedByRobots: detailAllowed,
  };
  if (items.length === 0) {
    stages.push({ name: "list-parse", ok: false, detail: "記事リンクを1件も解析できない(HTML構造が想定と違う可能性)" });
    failures.push({ stage: "list-parse", url: source.listUrl, errorKind: "PARSE_ZERO", error: "記事リンク0件" });
    return finish("LIST_PARSE_ZERO", "一覧は取得できたが記事リンクを解析できない。構造変更の可能性(案件0件ではない)", { list: listSummary });
  }
  stages.push({ name: "list-parse", ok: true, detail: `記事リンク${items.length}件・取得対象${targets.length}件` });
  if (!detailAllowed) {
    return finish("ROBOTS_DISALLOWED", "記事ページ(/information/)がrobots.txtで禁止されているため取得しなかった(案件0件ではない)", { list: listSummary });
  }
  if (targets.length === 0) {
    return finish("NO_CANDIDATE_IN_LIST", "一覧の解析は成功したが、ポケモンの抽選と判断できる題名が無かった。『存在しない』の証明ではなく、この一覧ページ1枚の範囲の結果", { list: listSummary, candidatesCount: 0 });
  }

  // ---- 工程4〜6: 記事の取得 → 抽出 → 検証 ----
  const candidates = [];
  let detailFailed = 0;
  let stopped = false;
  for (const t of targets) {
    if (stopped) { failures.push({ stage: "detail-fetch", url: t.url, errorKind: "SKIPPED_AFTER_BLOCK", error: "403/429を受けたため以降の取得を中止" }); detailFailed++; continue; }
    await sleep(source.limits.delayMs);
    const r = await fetcher(t.url);
    const le = ledgerEntry(++seq, "detail", r);
    ledger.push(le);
    if (!r.ok || !r.body) {
      detailFailed++;
      failures.push({ stage: "detail-fetch", url: t.url, errorKind: r.errorKind, status: r.status, error: r.error });
      if (r.status === 403 || r.status === 429) { stopped = true; }
      continue;
    }
    const d = decodeBody(r.body, r.headers["content-type"]);
    const id = idOf(t.url);
    let ex;
    try {
      ex = extractNotice({ html: d.text, url: t.url, listItem: t });
    } catch (e) {
      detailFailed++;
      failures.push({ stage: "extract", url: t.url, errorKind: "EXTRACT_EXCEPTION", error: String(e && e.message || e) });
      continue;
    }
    le.normalizedTextSha256 = sha256(Buffer.from(ex.normalizedText));
    le.charset = d.charset;
    bodies[`${id.replace(":", "-")}.html`] = maskSensitive(d.text);
    bodies[`${id.replace(":", "-")}.txt`] = maskSensitive(ex.normalizedText);
    const ver = verifyCandidate(ex, { fetchedAtMs: Date.parse(r.startedAt), noticeHost: new URL(source.listUrl).hostname, itemPathRe });
    const exPublic = { ...ex };
    delete exPublic.normalizedText; // 本文は bodies に別保存
    delete exPublic.textLength; // 本文長は比較ノイズになるため候補には含めない
    candidates.push({
      id, sourceId: source.sourceId, url: t.url, fetchedAt: r.startedAt, finalUrl: r.finalUrl,
      responseSha256: r.sha256, normalizedTextSha256: le.normalizedTextSha256,
      phase: phaseOf(ex.entryPeriod, Date.parse(r.startedAt)),
      display: labelsFor(ex),
      fields: exPublic,
      verification: ver,
      completeness: assessCompleteness(ex),
    });
  }
  stages.push({ name: "detail", ok: detailFailed === 0, detail: `取得対象${targets.length}件中、失敗${detailFailed}件` });
  const verdict = detailFailed === 0 ? "OK" : candidates.length > 0 ? "PARTIAL" : "DETAIL_ALL_FAILED";
  const detail = verdict === "OK" ? "取得工程は成功(一覧・記事とも取得でき、抽出・検証の処理が走った)。抽出の完全性は extractionVerdict を別に見ること"
    : verdict === "PARTIAL" ? `一部の記事の取得または抽出に失敗(失敗${detailFailed}件は failures を参照。成功分のみ candidates)`
      : "記事の取得がすべて失敗した(案件0件ではない)";
  return finish(verdict, detail, { list: listSummary, candidates, candidatesCount: verdict === "DETAIL_ALL_FAILED" ? null : candidates.length, detailAttempted: targets.length, detailFailed });
}
