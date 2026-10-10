// 抽出工程(取得・検証とは分離)。HTML文字列だけを入力にする純粋関数で、ネットワーク・ファイルに触れない。
// 方針:
//  - 項目ごとに { status: CONFIRMED | INFERRED | UNCONFIRMED, evidence: 原文の引用 } を持つ
//  - 根拠が無い項目は「未確認」。推測で埋めない
//  - 「公式アプリ内で応募」と確認できたときは、応募方法=公式アプリ／Web応募URL=なし。URLが無いだけで応募先未確認にしない
//  - 利用者本人の会員資格・利用履歴・受取可能店舗は不明なので、条件は表示するだけで「向き・不向き」を判定しない
//  - 複数店舗から選べる場合は「選択可能店舗」として保持し、受取必須店舗とは別に扱う
import { htmlToText, pickArticleScope, extractTitles, extractPublishedMeta, extractAnchors } from "./htmlText.mjs";
import { parsePeriodAfterLabel } from "./dates.mjs";

const UNCONFIRMED = "UNCONFIRMED";

export function fieldOf(value, status, quote, extra = {}) {
  return { value, status, evidence: quote ? { quote } : null, ...extra };
}

function firstLineMatching(lines, re) {
  for (const l of lines) { const m = re.exec(l); if (m) return { line: l, match: m }; }
  return null;
}

function periodField(text, labelRe) {
  const p = parsePeriodAfterLabel(text, labelRe);
  if (!p.found) return fieldOf(null, UNCONFIRMED, null, { reason: "本文に該当するラベルが無い" });
  const value = { start: p.start, end: p.end, deadlineOnly: !!p.deadlineOnly, single: !!p.single, approximate: !!p.approximate };
  return fieldOf(value, p.status, p.raw, { notes: p.notes, reason: p.status === UNCONFIRMED ? "日時を確定できない" : undefined });
}

// ---- 見出し(【…】だけの行)と、その後続行 ---------------------------------------
// 実サイトの記事は「【抽選受付期間】」の次の行に日時が書かれている。見出し行と値の行が分かれているため、
// 見出しごとに後続行をまとめて扱う(実取得本文 2026-10-10 で確認した構造)。
const HEADING_LINE = /^【([^】]{1,40})】$/;

export function splitSections(lines) {
  const sections = [];
  let cur = null;
  lines.forEach((l, i) => {
    const m = HEADING_LINE.exec(l.trim());
    if (m) { cur = { heading: m[1], index: i, lines: [] }; sections.push(cur); }
    else if (cur) cur.lines.push(l);
  });
  return sections;
}

const TIME_QUALIFIER = /(営業時間|開店|閉店|時まで|時から|時以降|時以前|終日)/;

/** 見出し→後続行の期間。日時は後続行から読み、時刻が無い場合は補完しない。「頃」「営業時間内」等の語は保持する。 */
function periodFromSection(sections, headingRe, label) {
  for (const sec of sections) {
    if (!headingRe.test(sec.heading)) continue;
    const body = sec.lines.map((l) => l.trim()).filter(Boolean);
    const idx = body.findIndex((l) => /\d{1,2}月\s*\d{1,2}日|\d{4}[\/.]\d{1,2}[\/.]\d{1,2}/.test(l));
    if (idx < 0) continue;
    const text = `${label}：${body[idx]}`;
    const p = parsePeriodAfterLabel(text, new RegExp(`${label}：`));
    if (!p.found) continue;
    const value = { start: p.start, end: p.end, deadlineOnly: !!p.deadlineOnly, single: !!p.single, approximate: !!p.approximate };
    const following = body.slice(idx + 1, idx + 4);
    const qualifier = following.find((l) => TIME_QUALIFIER.test(l) && l.length <= 40);
    const quote = `【${sec.heading}】\n${body[idx]}${qualifier ? `\n${qualifier}` : ""}`;
    return fieldOf(value, p.status, quote, {
      notes: p.notes, source: "section", heading: sec.heading,
      timeQualifier: qualifier || null,
      sectionLines: body.slice(0, 6),
      reason: p.status === UNCONFIRMED ? "日時を確定できない" : undefined,
    });
  }
  return null;
}

// ---- 応募方法 --------------------------------------------------------------
const APP_ENTRY_PATTERNS = [
  /応募(?:は|方法は|方法[:：])\s*[^。\n]{0,30}?アプリ\s*(?:内|より|から|で|を)/,
  /アプリ\s*(?:内の|内で|内から|内|より|から|で)\s*[^。\n]{0,15}?(?:ご)?(?:応募|エントリー)/,
];
const STORE_ENTRY = /店頭(?:にて|で)(?:の)?(?:ご)?(?:応募|受付|抽選)/;
const APP_STORE_HOSTS = ["apps.apple.com", "itunes.apple.com", "play.google.com"];

function appNameFrom(line) {
  const stripped = line.replace(/^.*?(?:ご)?応募(?:は|方法は|方法[:：])\s*/, "");
  const m = /([^\s「」『』、。:：【】()（）]{2,24}アプリ)/.exec(stripped) || /([^\s「」『』、。:：【】()（）]{2,24}アプリ)/.exec(line);
  return m ? m[1] : null;
}

function extractEntryMethod({ bodyLines, titleLine, articleHtml, noticeUrl }) {
  const methods = [];
  let evidence = [];
  let appName = null;
  const appLine = bodyLines.find((l) => APP_ENTRY_PATTERNS.some((re) => re.test(l)));
  if (appLine) { methods.push("APP"); evidence.push(appLine); appName = appNameFrom(appLine); }

  // Web応募URL: 応募・エントリー等の文字をもつリンクのうち、同じ記事・アプリストア以外の絶対URL
  const anchors = extractAnchors(articleHtml);
  let webUrl = null;
  let webEvidence = null;
  const appStoreLinks = [];
  for (const a of anchors) {
    let u;
    try { u = new URL(a.href, noticeUrl); } catch { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (APP_STORE_HOSTS.includes(u.hostname)) { appStoreLinks.push(u.toString()); continue; }
    if (u.toString() === new URL(noticeUrl).toString()) continue;
    if (/(応募|エントリー|申込|申し込み|抽選フォーム|抽選に参加)/.test(a.text)) {
      if (!webUrl) { webUrl = u.toString(); webEvidence = `${a.text} -> ${u.toString()}`; }
    }
  }
  if (webUrl) { methods.push("WEB"); evidence.push(webEvidence); }

  const storeLine = bodyLines.find((l) => STORE_ENTRY.test(l));
  if (storeLine) { methods.push("STORE"); evidence.push(storeLine); }

  const memberLabelLine = [titleLine, ...bodyLines].find((l) => l && /アプリ会員/.test(l)) || null;

  if (methods.length === 0) {
    return {
      status: UNCONFIRMED, methods: [], officialAppEntry: false, appName: null,
      webEntryUrl: null, webEntryUrlStatus: "未確認",
      appMemberOnlyLabel: memberLabelLine,
      note: memberLabelLine
        ? "題名または本文に「アプリ会員」の記載はあるが、応募手段(アプリ内応募など)の記載は確認できない"
        : "応募手段の記載を確認できない",
      appStoreLinks, evidence: [],
    };
  }
  const officialAppEntry = methods.includes("APP");
  return {
    status: "CONFIRMED", methods, officialAppEntry, appName,
    webEntryUrl: webUrl,
    // アプリ内応募が確認できた場合、URLが無いのは「なし」であり「未確認」ではない
    webEntryUrlStatus: webUrl ? "あり" : officialAppEntry ? "なし(アプリ内応募)" : "未確認",
    appMemberOnlyLabel: memberLabelLine,
    appStoreLinks, evidence,
  };
}

// ---- 受取方法・店舗 --------------------------------------------------------
const STORE_STOPWORDS = /^(?:ご利用|各|全|他|本|当|直営|加盟|対象|グループ|店舗|上記|下記|お近く|ご指定|お選び|指定|選択|ご選択|お申込み|お渡し|受取|ご購入|当選|購入|取扱|一部|提携|旗艦|実)?店$/;
const BRANDS = ["お宝創庫", "おじゃま館", "メディオ!", "メディオ", "プレイズ"];
const brandRe = (b, tail) => new RegExp(`^[【\\[■◆●▼]*${b.replace(/[!！]/g, "[!！]?")}[】\\]]*\\s*${tail}`);
const isBrandHeading = (l) => BRANDS.some((b) => { const m = brandRe(b, "[:：]?\\s*").exec(l); return m && l.slice(m[0].length).trim() === ""; });
const STORE_HEADER = /(受取店舗|受け取り店舗|お渡し店舗|お渡し場所|引換店舗|対象店舗|購入店舗|ご購入店舗|取扱店舗|応募可能店舗|受取可能店舗)/;
const SECTION_STOP = /^(?:※|■|◆|●|▼|【(?![^】]*店)|注意|ご注意|〈|<|・?(?:応募|当選|販売価格|価格|購入期間|当選発表|商品))/;

function splitStores(s) {
  const tokens = s.split(/[、,，／/・\s]+/).map((t) => t.trim()).filter(Boolean);
  const stores = [];
  const unparsed = [];
  for (const t of tokens) {
    const name = t.replace(/^[(（\[【「『]+|[)）\]】」』。.]+$/g, "");
    if (/店[!！]?$/.test(name) && name.length >= 3 && !STORE_STOPWORDS.test(name)) stores.push(name);
    else if (name.length > 0) unparsed.push(name);
  }
  return { stores, unparsed };
}

function parseStoreChunk(chunk) {
  let brandCurrent = null;
  const stores = [];
  const unparsed = [];
  for (const raw of chunk) {
    let line = raw.replace(STORE_HEADER, "").replace(/^[\s:：]+/, "");
    const bm = BRANDS.map((b) => ({ b, m: brandRe(b, "[:：]?\\s*").exec(line) })).find((x) => x.m);
    if (bm) { brandCurrent = bm.b.replace(/[!！]$/, "") === "メディオ" ? "メディオ！" : bm.b; line = line.slice(bm.m[0].length); }
    const { stores: s, unparsed: u } = splitStores(line);
    for (const name of s) stores.push({ name, brand: brandCurrent });
    if (s.length > 0) unparsed.push(...u);
  }
  // 同名の店舗でもブランドが違えば別の店(例: おじゃま館の三宮店とプレイズの三宮店)
  const seen = new Set();
  const uniq = stores.filter((s) => { const k = `${s.brand || ""}|${s.name}`; return seen.has(k) ? false : (seen.add(k), true); });
  return { stores: uniq, unparsed };
}


// 見出し「【対象店舗一覧】」の後に「■ ブランド名 店舗」「・店名」が並ぶ構造(実取得本文で確認)。
// ブランド名は固定リストに頼らず、■などで始まる小見出しから読む。
const STORE_SECTION_HEADING = /(対象店舗|受取店舗|受け取り店舗|お渡し店舗|引換店舗|購入店舗|取扱店舗|応募可能店舗|受取可能店舗)/;
const BRAND_MARK = /^[■◆●▼▶]\s*(.+?)\s*$/;
const BULLET = /^[・･•\-‐]\s*(.+?)\s*$/;

function extractStoresBySection(bodyLines) {
  const sections = splitSections(bodyLines);
  let best = null;
  for (const sec of sections) {
    if (!STORE_SECTION_HEADING.test(sec.heading)) continue;
    let brand = null;
    const stores = [];
    const unparsed = [];
    const quoteLines = [`【${sec.heading}】`];
    for (const raw of sec.lines) {
      const l = raw.trim();
      if (!l) continue;
      const bm = BRAND_MARK.exec(l);
      if (bm) { brand = bm[1].replace(/\s*店舗$/, "").trim(); quoteLines.push(l); continue; }
      const bl = BULLET.exec(l);
      if (bl) {
        const name = bl[1].trim();
        quoteLines.push(l);
        if (/店$/.test(name) && !STORE_STOPWORDS.test(name)) stores.push({ name, brand });
        else unparsed.push(name);
        continue;
      }
      if (/^[※▼▶]/.test(l) || l.length > 40) continue; // 注記・説明文は店舗として読まない
      if (/店$/.test(l) && !STORE_STOPWORDS.test(l) && brand) { stores.push({ name: l, brand }); quoteLines.push(l); }
    }
    const seen = new Set();
    const uniq = stores.filter((x) => { const k = `${x.brand || ""}|${x.name}`; return seen.has(k) ? false : (seen.add(k), true); });
    if (uniq.length > 0 && (!best || uniq.length > best.r.stores.length)) best = { r: { stores: uniq, unparsed }, chunk: quoteLines };
  }
  return best;
}

function extractStores(bodyLines) {
  const bySection = extractStoresBySection(bodyLines);
  if (bySection) {
    const wh = firstLineMatching(bodyLines, /(全店舗|全店|各店舗|グループ(?:全|各)店)[^。\n]{0,12}(?:受取|お渡し|購入|ご利用|可能)/);
    return { status: "CONFIRMED", stores: bySection.r.stores, unparsed: bySection.r.unparsed.slice(0, 30), via: "section", wholeStoreHint: wh?.line || null, evidence: bySection.chunk.join("\n").slice(0, 3000) };
  }
  const wholeStoreHint = firstLineMatching(bodyLines, /(全店舗|全店|各店舗|グループ(?:全|各)店)[^。\n]{0,12}(?:受取|お渡し|購入|ご利用|可能)/);
  // 見出し候補ごとに店舗名を数え、最も多く取れたものを採る(「ご購入店舗は応募時に…」のような説明文の見出し一致を避ける)
  const headerIdxs = bodyLines.map((l, i) => (STORE_HEADER.test(l) ? i : -1)).filter((i) => i >= 0);
  let best = null;
  for (const idx of headerIdxs) {
    const chunk = [];
    let seenStores = false;
    for (let i = idx; i < Math.min(bodyLines.length, idx + 60); i++) {
      const l = bodyLines[i];
      const brandHead = isBrandHeading(l);
      if (i > idx && SECTION_STOP.test(l) && !brandHead && !BRANDS.some((b) => brandRe(b, "").test(l))) break;
      const yields = parseStoreChunk([l]).stores.length > 0;
      // 店舗名が並ぶ行が終わったら、そこで一覧の終わりとみなす(後続の価格・注意書きを店舗として読まない)。ブランド見出しだけの行は続行
      if (i > idx && seenStores && !yields && !brandHead) break;
      if (yields) seenStores = true;
      chunk.push(l);
    }
    const r = parseStoreChunk(chunk);
    if (!best || r.stores.length > best.r.stores.length) best = { r, chunk, via: "header" };
  }
  // 見出しが無い/店舗が取れない場合: 「ブランド名: 店名…」の行を集める
  if (!best || best.r.stores.length === 0) {
    const brandLines = bodyLines.filter((l) => BRANDS.some((b) => brandRe(b, "[:：]").test(l)));
    if (brandLines.length > 0) {
      const r = parseStoreChunk(brandLines);
      if (r.stores.length > 0) best = { r, chunk: brandLines, via: "brand-lines" };
    }
  }
  if (!best || best.r.stores.length === 0) {
    return {
      status: UNCONFIRMED, stores: [], unparsed: best ? best.r.unparsed.slice(0, 30) : [],
      reason: headerIdxs.length === 0 ? "店舗一覧の見出しが見つからない" : "見出しの後に店舗名(…店)を抽出できなかった",
      wholeStoreHint: wholeStoreHint?.line || null, evidence: best ? best.chunk.join("\n").slice(0, 1500) : null,
    };
  }
  return {
    status: "CONFIRMED", stores: best.r.stores, unparsed: best.r.unparsed.slice(0, 30), via: best.via,
    wholeStoreHint: wholeStoreHint?.line || null, evidence: best.chunk.join("\n").slice(0, 1500),
  };
}

function extractReceiving(bodyLines) {
  const storeLine = firstLineMatching(bodyLines, /(店頭|店舗)[^。\n]{0,12}(受取|受け取り|お渡し|引換|ご購入|購入)/);
  const noMail = firstLineMatching(bodyLines, /(郵送|配送|発送)[^。\n]{0,14}(受付致しかね|対応致しかね|いたしかね|できません|不可|行っておりません|致しません|いたしません|ございません)/);
  if (storeLine && noMail) return { status: "CONFIRMED", method: "STORE_ONLY", deliveryOffered: false, evidence: [storeLine.line, noMail.line] };
  if (storeLine) return { status: "CONFIRMED", method: "STORE", deliveryOffered: null, evidence: [storeLine.line], note: "店頭受取の記載あり。配送の可否は記載から確認できない" };
  return { status: UNCONFIRMED, method: "UNKNOWN", deliveryOffered: null, evidence: [] };
}

function extractStoreSelection(bodyLines, titleLine) {
  const entryTime = firstLineMatching(bodyLines, /(応募時|エントリー時|申込時|お申込みの際|ご応募の際)[^。\n]{0,24}(選択|選んだ|お選び|指定)/)
    || firstLineMatching(bodyLines, /(受取店舗|お渡し店舗|店舗)[^。\n]{0,10}(を)?(選択|お選び|指定)[^。\n]{0,10}(して|の上|し)[^。\n]{0,10}(応募|エントリー)/);
  const onlyRe = [/【[^】]*?([^\s【】/／、]{1,20}店)のみ[^】]*】/, /([^\s、。【】]{2,20}店)(?:限定|のみ)(?:の)?(?:抽選|販売|受付|ご応募|お渡し)/];
  let required = null;
  for (const l of [titleLine, ...bodyLines]) {
    if (!l) continue;
    for (const re of onlyRe) { const m = re.exec(l); if (m) { required = { name: m[1], evidence: l }; break; } }
    if (required) break;
  }
  return {
    entryTimeChoice: entryTime ? { status: "CONFIRMED", evidence: entryTime.line } : { status: UNCONFIRMED },
    requiredStore: required,
  };
}

// ---- 応募条件(表示のみ。利用者本人に合うかの判定はしない) ---------------------
const COND_RULES = [
  ["PURCHASE_HISTORY", /(購入履歴|お買い上げ|お買上|買取|ご利用|利用実績|ご来店)[^。\n]{0,40}(以内|期間|間|実績|履歴|ある|あった|ない|なかった|必要)|(\d{4}(?:\/\d{1,2}\/\d{1,2}|年\s*\d{1,2}月\s*\d{1,2}日))\s*[〜～~-]\s*(\d{4}(?:\/\d{1,2}\/\d{1,2}|年\s*\d{1,2}月\s*\d{1,2}日))/],
  ["ID_VERIFICATION", /(本人確認|身分証|顔写真|写真付き)/],
  ["PROFILE_ACCURACY", /(住所|電話番号|生年月日|氏名)[^。\n]{0,20}(正しく|誤り|相違|ご確認|入力)/],
  ["ACCOUNT", /(パスワード|ログイン|アカウント)/],
  ["AGE", /(\d{1,2}歳以上|\d{1,2}歳未満|未成年)/],
  ["MEMBERSHIP", /会員/],
];

function extractConditions(bodyLines) {
  const out = [];
  let window = null;
  for (const l of bodyLines) {
    const cats = COND_RULES.filter(([, re]) => re.test(l)).map(([c]) => c);
    if (cats.length) out.push({ categories: cats, text: l });
    // 「2025/10/07〜2026/10/07」と「2025年10月07日〜2026年10月07日」の両方(実取得本文は後者)
    const D = "(\\d{4}(?:\\/\\d{1,2}\\/\\d{1,2}|年\\s*\\d{1,2}月\\s*\\d{1,2}日))";
    const w = new RegExp(`${D}\\s*[〜～~-]\\s*${D}`).exec(l);
    if (w && /(購入|利用|買取|お買|来店|ご利用)/.test(l) && !window) window = { from: w[1], to: w[2], evidence: l };
  }
  return { items: out.slice(0, 20), purchaseHistoryWindow: window };
}

function extractProducts(bodyLines) {
  const items = [];
  for (const l of bodyLines) {
    if (!/円/.test(l) || !/(税込|税抜|税別)/.test(l)) continue;
    const m = /([\d,]+)\s*円/.exec(l);
    items.push({ raw: l, amountYen: m ? parseInt(m[1].replace(/,/g, ""), 10) : null });
  }
  return items.slice(0, 20);
}

function extractLimit(bodyLines) {
  const hit = firstLineMatching(bodyLines, /(お一人様|おひとり様|1人|一人|1名様|お1人様)[^。\n]{0,14}(\d+|１)\s*(口|点|個|セット|BOX|箱|回|エントリー)/)
    || firstLineMatching(bodyLines, /1エントリー|一人様?1(?:口|回|点)/);
  return hit ? fieldOf(hit.line, "CONFIRMED", hit.line) : fieldOf(null, UNCONFIRMED, null);
}

function extractHandover(bodyLines) {
  const hits = bodyLines.filter((l) => /(転売|代理|譲渡|本人のみ|ご本人様のみ|当選者のみ|スクリーンショット|身分証)/.test(l));
  return hits.slice(0, 10);
}

// ---- 一覧ページ ---------------------------------------------------------------
const DATE_IN_LIST = /(\d{4})[./](\d{1,2})[./](\d{1,2})/;

export function parseListPage(html, listUrl, itemPathRe) {
  const base = new URL(listUrl);
  const anchors = extractAnchors(stripScriptsOnly(html));
  const byUrl = new Map();
  for (const a of anchors) {
    let u;
    try { u = new URL(a.href, base); } catch { continue; }
    if (u.hostname !== base.hostname) continue;
    if (!itemPathRe.test(u.pathname)) continue;
    const canonical = `${u.origin}${u.pathname.endsWith("/") ? u.pathname : u.pathname + "/"}`;
    let text = a.text;
    let date = DATE_IN_LIST.exec(text);
    let dateSource = date ? "anchor" : null;
    if (!date) {
      const before = html.slice(Math.max(0, a.index - 400), a.index);
      const all = [...before.matchAll(new RegExp(DATE_IN_LIST.source, "g"))];
      if (all.length) { date = all[all.length - 1]; dateSource = "preceding-html"; }
    }
    if (date && dateSource === "anchor") text = text.replace(DATE_IN_LIST, "").trim();
    const dateIso = date ? `${date[1]}-${String(date[2]).padStart(2, "0")}-${String(date[3]).padStart(2, "0")}` : null;
    const prev = byUrl.get(canonical);
    const entry = { url: canonical, title: text, date: dateIso, dateSource };
    if (!prev) byUrl.set(canonical, entry);
    else {
      // 同じ記事へのリンクが複数(画像リンク+文字リンク)ある場合は、題名が長い方・日付がある方を採る
      if (entry.title.length > prev.title.length) prev.title = entry.title;
      if (!prev.date && entry.date) { prev.date = entry.date; prev.dateSource = entry.dateSource; }
    }
  }
  return [...byUrl.values()];
}

function stripScriptsOnly(html) {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

/** 一覧の題名から、取得対象かどうかを決める。除外理由も返す(黙って捨てない)。 */
export function classifyListItem(item, rules) {
  const t = item.title || "";
  const isLottery = rules.lotteryWords.some((w) => t.includes(w));
  const isPokemon = rules.gameWords.some((w) => t.includes(w));
  const isResult = rules.resultWords.some((w) => t.includes(w));
  if (!isLottery) return { fetch: false, reason: "題名に「抽選」を含まない(お知らせ・イベント等)" };
  if (isResult) return { fetch: false, reason: "抽選の結果告知とみられる題名" };
  if (!isPokemon) return { fetch: false, reason: "抽選だがポケモン以外の題名" };
  return { fetch: true, reason: null };
}

// ---- 1記事の抽出 -------------------------------------------------------------
function countByBrand(stores) {
  const o = {};
  for (const x of stores) { const k = x.brand || "(ブランド不明)"; o[k] = (o[k] || 0) + 1; }
  return o;
}

export function extractNotice({ html, url, listItem = null }) {
  const { html: articleHtml, scope } = pickArticleScope(html);
  const text = htmlToText(articleHtml);
  const lines = text.split("\n");
  const titles = extractTitles(html);
  const titleLine = (titles.h1 || titles.ogTitle || titles.title || listItem?.title || "").normalize("NFKC");
  const titleSource = titles.h1 ? "h1" : titles.ogTitle ? "og:title" : titles.title ? "title" : listItem?.title ? "list" : null;
  const bodyLines = lines.filter((l) => l !== titleLine);
  const fullNormalized = [titleLine, ...bodyLines].join("\n");

  const isLottery = /抽選/.test(titleLine) || bodyLines.some((l) => /抽選販売/.test(l));
  const isPokemon = /ポケモン|ポケカ/.test(titleLine) || bodyLines.slice(0, 6).some((l) => /ポケモン|ポケカ/.test(l));

  const meta = extractPublishedMeta(html);
  let posted = fieldOf(null, UNCONFIRMED, null);
  if (listItem?.date) posted = fieldOf(listItem.date, "CONFIRMED", `一覧の日付: ${listItem.date}`, { source: `list(${listItem.dateSource})` });
  else if (meta) posted = fieldOf(meta.value.slice(0, 10), "CONFIRMED", meta.value, { source: meta.source });
  else {
    const m = /(\d{4})[./](\d{1,2})[./](\d{1,2})/.exec(lines.slice(0, 8).join("\n"));
    if (m) posted = fieldOf(`${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`, "CONFIRMED", m[0], { source: "body-head" });
  }

  const sections = splitSections(bodyLines);
  // 見出し→後続行を先に読み、見つからないときだけ「ラベル：値」の同一行形式へ戻る
  const entryPeriod = periodFromSection(sections, /(応募|エントリー|受付|申込|申し込み)期間/, "応募期間")
    || periodField(fullNormalized, /(?:応募|エントリー|受付)期間\s*[:：]\s*/);
  const resultAnnouncement = periodFromSection(sections, /当選(通知|発表|のご案内|者発表)|抽選結果|結果発表/, "当選発表")
    || periodField(fullNormalized, /(?:当選発表|抽選結果(?:発表)?|結果発表|当選者発表|当選のご案内)\s*[:：]\s*/);
  const purchasePeriod = periodFromSection(sections, /(購入|お渡し|引換|引き換え)期間|販売期間/, "購入期間")
    || periodField(fullNormalized, /(?:ご?購入期間|お渡し期間|引換期間|引き換え期間|販売期間)\s*[:：]\s*/);

  const entryMethod = extractEntryMethod({ bodyLines, titleLine, articleHtml, noticeUrl: url });
  const receiving = extractReceiving(bodyLines);
  const storeList = extractStores(bodyLines);
  const storeSelection = extractStoreSelection(bodyLines, titleLine);
  const conditions = extractConditions(bodyLines);
  const products = extractProducts(bodyLines);

  const selectableStores = {
    status: storeList.status,
    stores: storeList.stores,
    byBrand: countByBrand(storeList.stores),
    selection: storeSelection.entryTimeChoice,
    // 掲載されている店舗は「選択可能店舗」。受取必須店舗(その店でしか受け取れない)とは別に持つ。
    note: "掲載店舗は選択可能店舗として保持。受取必須店舗とは決めつけない",
    unparsedTokens: storeList.unparsed,
    reason: storeList.reason,
    wholeStoreHint: storeList.wholeStoreHint,
    evidence: storeList.evidence ? { quote: storeList.evidence } : null,
  };
  const requiredStore = storeSelection.requiredStore
    ? fieldOf(storeSelection.requiredStore.name, "CONFIRMED", storeSelection.requiredStore.evidence)
    : fieldOf(null, UNCONFIRMED, null, {
        reason: storeSelection.entryTimeChoice.status === "CONFIRMED"
          ? "応募時に店舗を選択する記載がある。受取必須店舗は確定しない"
          : "「〇〇店のみ」等の記載なし",
      });

  return {
    url, scope, titleSource,
    title: titleLine,
    isLottery, isPokemon,
    postedDate: posted,
    entryPeriod, resultAnnouncement, purchasePeriod,
    entryMethod, receiving, selectableStores, requiredStore,
    eligibilityConditions: {
      items: conditions.items,
      purchaseHistoryWindow: conditions.purchaseHistoryWindow,
      // 利用者本人の会員資格・利用履歴は本ツールでは不明。表示のみで判定しない。
      userEligibility: "未確認(利用者の会員資格・利用履歴・受取可能店舗は不明)",
    },
    products,
    perPersonLimit: extractLimit(bodyLines),
    handoverRestrictions: extractHandover(bodyLines),
    textLength: text.length,
    normalizedText: fullNormalized,
  };
}
