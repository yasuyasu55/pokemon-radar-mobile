// 検証工程: 抽出結果を本文・日付の整合性で確認する。ここでも推測で埋めず、確認できない項目は UNCONFIRMED のまま残す。
import { isoToMs } from "./dates.mjs";

const mk = (id, status, message) => ({ id, status, message });

function dateOf(v) { return v && (v.date || null); }

function eachDt(period) {
  const out = [];
  const v = period?.value;
  if (!v) return out;
  for (const k of ["start", "end"]) if (v[k]) out.push(v[k]);
  return out;
}

export function verifyCandidate(ex, { fetchedAtMs, noticeHost, itemPathRe }) {
  const checks = [];
  // C01 URL
  try {
    const u = new URL(ex.url);
    checks.push(u.hostname === noticeHost && itemPathRe.test(u.pathname) ? mk("C01_URL", "PASS", "公式ホストの記事URL") : mk("C01_URL", "FAIL", `想定外のURL: ${ex.url}`));
  } catch { checks.push(mk("C01_URL", "FAIL", "URLを解釈できない")); }
  // C02 題名・抽選
  checks.push(ex.title ? mk("C02_TITLE", "PASS", "題名あり") : mk("C02_TITLE", "FAIL", "題名を取得できない"));
  checks.push(ex.isLottery ? mk("C03_LOTTERY", "PASS", "抽選の記事") : mk("C03_LOTTERY", "WARN", "抽選の記事と確認できない"));
  // C04 応募期間
  const ep = ex.entryPeriod;
  if (ep.status === "UNCONFIRMED") checks.push(mk("C04_ENTRY_PERIOD", "UNCONFIRMED", ep.reason || "応募期間を確定できない"));
  else if (ep.status === "INFERRED") checks.push(mk("C04_ENTRY_PERIOD", "WARN", "応募期間の年を開始日から引き継いだ(本文に年の記載なし)"));
  else checks.push(mk("C04_ENTRY_PERIOD", "PASS", "応募期間を本文の日時から確定"));
  const s = ep.value?.start, e = ep.value?.end;
  if (s?.iso && e?.iso) checks.push(isoToMs(s.iso) < isoToMs(e.iso) ? mk("C05_ENTRY_ORDER", "PASS", "開始<締切") : mk("C05_ENTRY_ORDER", "FAIL", "締切が開始より前"));
  else if (s?.date && e?.date) checks.push(s.date <= e.date ? mk("C05_ENTRY_ORDER", "PASS", "開始日<=締切日(時刻未確認あり)") : mk("C05_ENTRY_ORDER", "FAIL", "締切日が開始日より前"));
  else checks.push(mk("C05_ENTRY_ORDER", "UNCONFIRMED", "期間の両端が揃わず順序を確認できない"));
  // C06 曜日の整合
  const mism = [];
  for (const f of ["entryPeriod", "resultAnnouncement", "purchasePeriod"]) for (const d of eachDt(ex[f])) if (d.weekdayMatches === false) mism.push(`${f}: ${d.raw}`);
  checks.push(mism.length ? mk("C06_WEEKDAY", "WARN", `曜日と日付が一致しない: ${mism.join(" / ")}`) : mk("C06_WEEKDAY", "PASS", "曜日の記載がある日付は日付と一致(記載なしは対象外)"));
  // C07 発表・購入期間の前後関係
  const rv = ex.resultAnnouncement.value?.start;
  const pv = ex.purchasePeriod.value;
  const endDate = dateOf(e);
  const order = [];
  if (endDate && dateOf(rv) && dateOf(rv) < endDate) order.push("当選発表が応募締切より前");
  if (dateOf(rv) && dateOf(pv?.start) && dateOf(pv.start) < dateOf(rv)) order.push("購入開始が当選発表より前");
  if (dateOf(pv?.start) && dateOf(pv?.end) && dateOf(pv.end) < dateOf(pv.start)) order.push("購入終了が購入開始より前");
  const comparable = (endDate && dateOf(rv)) || (dateOf(rv) && dateOf(pv?.start)) || (dateOf(pv?.start) && dateOf(pv?.end));
  checks.push(order.length ? mk("C07_SEQUENCE", "WARN", order.join(" / ")) : comparable ? mk("C07_SEQUENCE", "PASS", "応募→発表→購入の順に矛盾なし") : mk("C07_SEQUENCE", "UNCONFIRMED", "比較できる日付が足りない"));
  // C08 掲載日と期間
  const posted = ex.postedDate.value;
  if (posted && endDate) checks.push(posted <= endDate ? mk("C08_POSTED", "PASS", "掲載日<=応募締切日") : mk("C08_POSTED", "WARN", "掲載日が応募締切日より後"));
  else checks.push(mk("C08_POSTED", "UNCONFIRMED", "掲載日または締切日を確認できない"));
  // C09 現在日時との妥当性
  const dts = [...eachDt(ex.entryPeriod), ...eachDt(ex.resultAnnouncement), ...eachDt(ex.purchasePeriod)].map((d) => (d.iso ? isoToMs(d.iso) : d.date ? Date.parse(d.date + "T00:00:00+09:00") : null)).filter((x) => x != null);
  const far = dts.filter((t) => Math.abs(t - fetchedAtMs) > 400 * 86400e3);
  checks.push(far.length ? mk("C09_PLAUSIBLE", "WARN", `取得日時から400日以上離れた日付が${far.length}件`) : dts.length ? mk("C09_PLAUSIBLE", "PASS", "日付は取得日時の前後400日以内") : mk("C09_PLAUSIBLE", "UNCONFIRMED", "日付なし"));
  // C10 応募方法
  const em = ex.entryMethod;
  checks.push(em.status === "CONFIRMED" ? mk("C10_ENTRY_METHOD", "PASS", `応募方法: ${em.methods.join("+")}`) : mk("C10_ENTRY_METHOD", "UNCONFIRMED", em.note || "応募方法を確認できない"));
  if (em.officialAppEntry && em.webEntryUrl) checks.push(mk("C11_APP_WEB", "WARN", "アプリ応募とWeb応募URLの両方の記載がある(両方を保持)"));
  // C12 店舗
  const st = ex.selectableStores;
  if (st.status === "CONFIRMED") checks.push(mk("C12_STORES", "PASS", `選択可能店舗${st.stores.length}件を抽出`));
  else checks.push(mk("C12_STORES", ex.receiving.method === "UNKNOWN" ? "UNCONFIRMED" : "UNCONFIRMED", st.reason || "店舗を抽出できない"));
  if (st.unparsedTokens?.length) checks.push(mk("C13_STORE_TOKENS", "WARN", `店舗名として解釈できなかった語が${st.unparsedTokens.length}件(店舗一覧の書式差の可能性)`));
  // C14 根拠の実在(引用が正規化本文に含まれるか)
  const bad = [];
  const norm = ex.normalizedText;
  const quoteOf = (f) => (f && f.evidence && f.evidence.quote) || null;
  for (const [name, f] of Object.entries({ entryPeriod: ex.entryPeriod, resultAnnouncement: ex.resultAnnouncement, purchasePeriod: ex.purchasePeriod, requiredStore: ex.requiredStore })) {
    const q = quoteOf(f);
    if (f.status !== "UNCONFIRMED" && q && !q.split("\n").every((part) => norm.includes(part.trim()))) {
      // 期間は「ラベル+後続テキスト」の連結なので、先頭部分で照合する
      const head = q.slice(0, 24);
      if (!norm.includes(head)) bad.push(name);
    }
  }
  for (const l of em.evidence || []) { const first = String(l).split(" -> ")[0]; if (first && !norm.includes(first.slice(0, 30)) && !/->/.test(String(l))) bad.push("entryMethod"); }
  checks.push(bad.length ? mk("C14_EVIDENCE", "FAIL", `根拠の引用が本文中に見つからない: ${[...new Set(bad)].join(",")}`) : mk("C14_EVIDENCE", "PASS", "根拠の引用はすべて正規化本文に実在"));
  // C15 推測の有無
  const inferred = ["entryPeriod", "resultAnnouncement", "purchasePeriod"].filter((f) => ex[f].status === "INFERRED");
  if (inferred.length) checks.push(mk("C15_INFERRED", "WARN", `推測を含む項目: ${inferred.join(",")}`));
  // C16 時刻未確認
  const tu = [];
  for (const f of ["entryPeriod", "resultAnnouncement", "purchasePeriod"]) for (const d of eachDt(ex[f])) if (d.timeUnconfirmed) tu.push(`${f}:${d.raw}`);
  if (tu.length) checks.push(mk("C16_TIME_UNCONFIRMED", "INFO", `時刻の記載なし(補完しない): ${tu.join(" / ")}`));

  const fails = checks.filter((c) => c.status === "FAIL").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  const unconf = checks.filter((c) => c.status === "UNCONFIRMED").length;
  return { checks, overall: fails ? "FAIL" : warns ? "WARN" : unconf ? "INCOMPLETE" : "OK", counts: { fails, warns, unconfirmed: unconf } };
}

/** 現在時刻に対する応募の進み具合。日時が確定していなければ UNKNOWN。 */
export function phaseOf(entryPeriod, nowMs) {
  const v = entryPeriod?.value;
  const s = v?.start?.iso ? isoToMs(v.start.iso) : null;
  const e = v?.end?.iso ? isoToMs(v.end.iso) : null;
  if (e != null && nowMs > e) return "ENTRY_CLOSED";
  if (s != null && nowMs < s) return "BEFORE_ENTRY";
  if (s != null && e != null) return "ENTRY_OPEN";
  if (e != null && s == null) return "ENTRY_OPEN_OR_BEFORE(開始日時なし)";
  return "UNKNOWN";
}

/**
 * 抽出の完全性(取得が成功したかとは別の評価)。
 * 候補として使うのに必要な項目が、原文を根拠に確定できているかを項目ごとに数える。
 * 状態: OK(確定) / OK_WITH_NOTE(確定。時刻なし・「頃」・営業時間内などの原文注記つき) / MISSING(未確認)
 * 時刻が無い日付は補完せず、日付のみで OK_WITH_NOTE とする。
 */
export function assessCompleteness(ex) {
  const items = [];
  const add = (key, label, state, note = null) => items.push({ key, label, state, note });
  const period = (key, label, f, { needEnd = false } = {}) => {
    const v = f.value;
    const hasStart = !!(v && v.start && v.start.date);
    const hasEnd = !!(v && v.end && v.end.date);
    if (f.status === "UNCONFIRMED" || !hasStart || (needEnd && !hasEnd)) return add(key, label, "MISSING", f.reason || "日時を確定できない");
    const notes = [];
    if ([v.start, v.end].some((d) => d && d.timeUnconfirmed)) notes.push("時刻の記載なし(補完しない)");
    if (v.approximate) notes.push("「頃」の記載あり");
    if (f.timeQualifier) notes.push(`原文: ${f.timeQualifier}`);
    if (f.status === "INFERRED") notes.push("年を引き継いだ(推測を含む)");
    add(key, label, notes.length ? "OK_WITH_NOTE" : "OK", notes.join(" / ") || null);
  };
  add("title", "題名", ex.title ? "OK" : "MISSING");
  add("postedDate", "掲載日", ex.postedDate.value ? "OK" : "MISSING");
  period("entryPeriod", "応募期間", ex.entryPeriod, { needEnd: true });
  period("resultAnnouncement", "当選発表", ex.resultAnnouncement);
  period("purchasePeriod", "購入期間", ex.purchasePeriod, { needEnd: true });
  add("entryMethod", "応募方法", ex.entryMethod.status === "CONFIRMED" ? "OK" : "MISSING", ex.entryMethod.note || null);
  add("receiving", "受取方法", ex.receiving.status === "CONFIRMED" ? "OK" : "MISSING");
  const storeNeeded = ex.receiving.method === "STORE" || ex.receiving.method === "STORE_ONLY";
  if (storeNeeded) add("stores", "選択可能店舗", ex.selectableStores.status === "CONFIRMED" && ex.selectableStores.stores.length > 0 ? "OK" : "MISSING", ex.selectableStores.status === "CONFIRMED" ? `${ex.selectableStores.stores.length}店舗` : ex.selectableStores.reason || null);
  add("conditions", "応募条件(表示用)", ex.eligibilityConditions.items.length > 0 ? "OK" : "MISSING");
  add("products", "商品・価格", ex.products.length > 0 ? "OK" : "MISSING");
  const missing = items.filter((i) => i.state === "MISSING").map((i) => i.label);
  return { level: missing.length === 0 ? "COMPLETE" : "INCOMPLETE", missing, items };
}
