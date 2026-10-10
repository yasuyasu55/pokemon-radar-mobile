import { runnerLabelOf } from "./status.mjs";
// 人が読む要約(Markdown)。「何が確認できて、何が確認できていないか」を毎回同じ形で出す。
const jst = (iso) => (iso ? iso.replace("T", " ").replace(/\+09:00$/, " JST") : "未確認");
const periodText = (f) => {
  if (!f || f.status === "UNCONFIRMED" || !f.value) return `未確認${f?.evidence?.quote ? `(原文: ${f.evidence.quote})` : ""}`;
  const v = f.value;
  const one = (d) => (d ? (d.iso ? jst(d.iso) : d.date ? `${d.date}(時刻の記載なし)` : `未確定(${d.raw})`) : "—");
  const tag = (f.status === "INFERRED" ? " ※年を引き継いだ推測を含む" : "") + (v.approximate ? " ※「頃」(おおよその日時)" : "") + (f.timeQualifier ? ` ※原文: ${f.timeQualifier}` : "");
  if (v.deadlineOnly) return `〜 ${one(v.end)}${tag}`;
  if (v.single) return `${one(v.start)}${tag}`;
  return `${one(v.start)} 〜 ${one(v.end)}${tag}`;
};

export function renderRunReport(r) {
  const L = [];
  L.push(`# お宝創庫 dry-run 結果(${r.runLabel})`);
  L.push("");
  if (r.env && r.env.mode === "REPLAY") L.push("- 取得方法: **保存済みHTMLの再生**(通信なし)");
  else if (r.env && r.env.mode === "REANALYSIS") L.push("- 取得方法: **保存本文の再解析**(新しい実取得ではない。通信の記録・取得時刻は元の実取得のもの)");
  else L.push(`- 取得方法: **通常HTTP(ブラウザ不使用)**。Cookieなし・新しい接続・キャッシュ無効ヘッダー`);
  L.push(`- 実行環境: **${runnerLabelOf(r)}** ／ ツール: ${r.tool || "不明"}`);
  L.push(`- 開始: ${jst(r.startedAt)} ／ 終了: ${jst(r.finishedAt)}`);
  L.push(`- **取得工程の判定: ${r.verdict}** — ${r.verdictDetail}`);
  const xv = r.extractionVerdict;
  L.push(`- **抽出の完全性: ${xv ? xv.level : "未評価"}** — ${xv ? xv.detail : ""}${xv && xv.missing && xv.missing.length ? `(未確認の項目: ${xv.missing.join("、")})` : ""}`);
  L.push("- ※「取得工程の判定」が OK でも、抽出の完全性が COMPLETE でなければ完成とは判断しません。");
  L.push(`- 候補件数: **${r.counts.candidates === null ? "判定不能(0件ではない)" : r.counts.candidates + "件"}** ／ 記事取得 ${r.counts.detailAttempted}件中 失敗${r.counts.detailFailed}件`);
  L.push("");
  L.push("## 取得した内容の区別");
  const label = runnerLabelOf(r);
  if (r.env && r.env.mode === "REPLAY") L.push("- **この結果は保存済みHTMLの再生(開発用)です。実取得ではありません。**");
  else if (r.env && r.env.mode === "REANALYSIS") L.push("- **この結果は『保存本文の再解析』です。新しい実取得ではありません。** 通信の記録は元の実取得、抽出値は現行の抽出器で保存本文を解析し直したものです。");
  else L.push(`- この結果は「${label}から通常HTTPで実際に取得した結果」です。人工データのテスト・要約取得ツールでの確認とは別です。`);
  L.push("");
  L.push("## 通信の記録");
  L.push("| # | 工程 | URL | 状態 | バイト | SHA-256(先頭12) | 時間ms |");
  L.push("|---|---|---|---|---|---|---|");
  for (const e of r.ledger) L.push(`| ${e.seq} | ${e.stage} | ${e.requestedUrl} | ${e.ok ? "HTTP " + e.status : (e.errorKind || "失敗") + (e.status ? " " + e.status : "")} | ${e.bytes} | ${e.sha256 ? e.sha256.slice(0, 12) : "—"} | ${e.durationMs} |`);
  if (r.failures.length) {
    L.push("");
    L.push("## 失敗の記録(案件0件として扱っていません)");
    for (const f of r.failures) L.push(`- 段階: ${f.stage} ／ ${f.url} ／ ${f.errorKind || ""} ${f.status || ""} ${f.error || ""}`);
  }
  if (r.list) {
    L.push("");
    L.push("## 一覧ページの解析");
    L.push(`- 解析できた記事リンク: ${r.list.itemsParsed}件 ／ 取得対象(ポケモンの抽選と判断): ${r.list.targets.length}件`);
    for (const x of r.list.excluded.slice(0, 40)) L.push(`  - 除外: ${x.date || "日付なし"} ${x.title || "(題名なし)"} — ${x.reason}`);
    if (r.list.skippedByDetailCap.length) L.push(`  - 取得上限のため未取得: ${r.list.skippedByDetailCap.length}件`);
  }
  for (const c of r.candidates) {
    const f = c.fields;
    L.push("");
    L.push(`## 候補 ${c.id}`);
    L.push(`- 題名: ${f.title}`);
    L.push(`- URL: ${c.url}`);
    L.push(`- 掲載日: ${f.postedDate.value || "未確認"}`);
    L.push(`- 進み具合(取得時点): ${c.phase}`);
    L.push(`- 応募期間: ${periodText(f.entryPeriod)}`);
    L.push(`- 当選発表: ${periodText(f.resultAnnouncement)}`);
    L.push(`- 購入期間: ${periodText(f.purchasePeriod)}`);
    L.push(`- **応募方法: ${c.display.entryMethodLabel}** ／ **Web応募URL: ${c.display.webEntryUrlLabel}**`);
    L.push(`- 受取方法: ${c.display.receivingLabel}`);
    L.push(`- ${c.display.storesLabel} ／ ${c.display.requiredStoreLabel}`);
    L.push(`- 利用者の資格: ${c.display.userEligibilityLabel}`);
    if (f.eligibilityConditions.items.length) {
      L.push("- 応募条件(原文。本人に合うかは判定していません):");
      for (const it of f.eligibilityConditions.items) L.push(`  - [${it.categories.join("+")}] ${it.text}`);
    }
    if (f.eligibilityConditions.purchaseHistoryWindow) L.push(`- 利用実績の対象期間: ${f.eligibilityConditions.purchaseHistoryWindow.from} 〜 ${f.eligibilityConditions.purchaseHistoryWindow.to}`);
    if (f.products.length) for (const p of f.products) L.push(`- 価格行: ${p.raw}`);
    if (f.perPersonLimit.value) L.push(`- 数量制限: ${f.perPersonLimit.value}`);
    for (const h of f.handoverRestrictions) L.push(`- 引き渡し条件(原文): ${h}`);
    L.push(`- 抽出の完全性: **${c.completeness.level}**${c.completeness.missing.length ? `(未確認: ${c.completeness.missing.join("、")})` : ""}`);
    for (const it of c.completeness.items.filter((x) => x.state !== "OK")) L.push(`  - ${it.state} ${it.label}${it.note ? `: ${it.note}` : ""}`);
    if (f.selectableStores.byBrand && Object.keys(f.selectableStores.byBrand).length) L.push(`- 選択可能店舗の内訳: ${Object.entries(f.selectableStores.byBrand).map(([b, n]) => `${b} ${n}`).join(" / ")}`);
    L.push(`- 検証: **${c.verification.overall}**`);
    for (const k of c.verification.checks.filter((x) => x.status !== "PASS")) L.push(`  - ${k.status} ${k.id}: ${k.message}`);
  }
  L.push("");
  L.push("## 注意");
  for (const n of r.notes) L.push(`- ${n}`);
  return L.join("\n") + "\n";
}

export function renderCompareReport(c) {
  const L = [];
  L.push("# 2回の独立取得の比較");
  L.push("");
  L.push(`- 総合: **${c.overall}** ／ 判定: 1回目 ${c.verdicts[0]} ・ 2回目 ${c.verdicts[1]}`);
  L.push(`- 独立性: プロセス ${c.independence.pids.join(" と ")}(同一プロセス: ${c.independence.sameProcess ? "はい" : "いいえ"}) ／ 同じURLでローカルポートが毎回違う: ${c.independence.localPortsDifferForSameUrl ? "はい" : "いいえ/判定不能"}`);
  L.push(`- ${c.independence.note}`);
  L.push("");
  L.push("| URL | 工程 | 分類 | 備考 |");
  L.push("|---|---|---|---|");
  for (const r of c.rows) L.push(`| ${r.url} | ${r.stage} | ${r.classification} | ${r.detail} |`);
  if (c.candidatesOnlyInRun1.length || c.candidatesOnlyInRun2.length) {
    L.push("");
    L.push(`- 1回目だけの候補: ${c.candidatesOnlyInRun1.join(", ") || "なし"} ／ 2回目だけの候補: ${c.candidatesOnlyInRun2.join(", ") || "なし"}`);
  }
  L.push("");
  L.push("応答のハッシュが違っても、本文・抽出内容が同じなら失敗とはしません(分類で区別しています)。");
  return L.join("\n") + "\n";
}

const EXPLAIN = {
  IDENTICAL_RESPONSE: "応答(バイト列)が一致",
  SAME_TEXT_DIFF_BYTES: "バイト列は違うが本文テキストは同一(動的な属性等の差。本文の変更ではない)",
  TEXT_CHANGED_EXTRACTION_SAME: "本文は変わっているが、抽出した案件情報は同一(抽出対象外の箇所の変更)",
  TEXT_CHANGED_EXTRACTION_CHANGED: "本文が変わり、抽出した案件情報も変わった(記事の更新の可能性。取得時刻の差を確認)",
  TEXT_CHANGED_EXTRACTION_NOT_COMPARED: "本文が変わった。抽出器の版が違うため、抽出値の差は比較していない",
  SAME_TEXT_EXTRACTION_DIFFERS: "本文は同じなのに抽出結果が違う(抽出処理の非決定性または環境依存の疑い。要調査)",
  SAME_TEXT_EXTRACTION_NOT_COMPARED: "本文は同一。抽出器の版が違うため、抽出値の差は比較していない",
  TEXT_CHANGED_NO_CANDIDATE: "本文が変わった(案件として抽出できるページではない。一覧・robots等)",
  ONE_SIDE_FAILED: "片方の環境でだけ取得に失敗",
  BOTH_FAILED: "両方の環境で取得に失敗",
  MISSING_IN_ONE: "片方の環境に該当リクエストが無い",
};

export function renderCrossEnvReport(c) {
  const L = [];
  L.push("# 環境間の比較(同じ情報源を別の環境で取得した結果)");
  L.push("");
  L.push(`- A: **${c.a.label}** ／ ${c.a.tool} ／ 取得工程 ${c.a.verdict} ／ 抽出の完全性 ${c.a.extraction}`);
  L.push(`- B: **${c.b.label}** ／ ${c.b.tool} ／ 取得工程 ${c.b.verdict} ／ 抽出の完全性 ${c.b.extraction}`);
  L.push(`- 総合: **${c.overall}** — ${c.overallDetail}`);
  L.push(`- 抽出値の比較: ${c.extractionComparable ? "実施(同じ版の抽出器)" : `未実施 — ${c.extractionNote}`}`);
  L.push("- 判定の方針: 応答ハッシュの一致は必須にしない。『本文の変更』と『抽出結果の差』を分けて分類する。");
  L.push("");
  L.push("| URL | 工程 | 分類 | 説明 |");
  L.push("|---|---|---|---|");
  for (const r of c.rows) L.push(`| ${r.url} | ${r.stage || ""} | ${r.classification} | ${EXPLAIN[r.classification] || r.detail || ""} |`);
  for (const r of c.rows.filter((x) => x.fieldDiffs && x.fieldDiffs.length)) {
    L.push("");
    L.push(`## 抽出値の差: ${r.url}`);
    L.push(`- 取得時刻 A: ${r.fetchedAt[0] || "—"} ／ B: ${r.fetchedAt[1] || "—"}`);
    for (const d of r.fieldDiffs.slice(0, 40)) L.push(`- [${d.kind === "VALUE" ? "値" : "根拠の引用のみ"}] ${d.path}: ${JSON.stringify(d.a)} → ${JSON.stringify(d.b)}`);
    if (r.fieldDiffs.length > 40) L.push(`- …ほか${r.fieldDiffs.length - 40}件`);
  }
  return L.join("\n") + "\n";
}
