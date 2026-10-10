// 日本語の日時表現の解析。日本時間(+09:00)基準。推測はしない:
//  - 年が無い日付は、同じ文中の開始日の年を引き継いだときだけ「INFERRED」として明示する
//  - 時刻が無い日付は時刻を補完せず timeUnconfirmed=true にする
//  - 解釈できなかった表現は null を返し、呼び出し側が「未確認」にする(原文は残る)

const WEEKDAYS = "日月火水木金土";

const DT_RE = new RegExp(
  [
    "(?:(\\d{4})\\s*[年/.]\\s*)?", //1 year
    "(\\d{1,2})\\s*[月/.]\\s*(\\d{1,2})\\s*日?", //2 month 3 day
    "(?:\\s*[(（]\\s*([日月火水木金土])\\s*(?:曜日?)?\\s*[)）])?", //4 weekday
    "(?:\\s*(?:(午前|午後|AM|PM|am|pm|ひる|昼|朝|夜|夕方|夕)?\\s*(?:(\\d{1,2})\\s*時(?:\\s*(\\d{1,2})\\s*分|\\s*(半))?|(\\d{1,2}):(\\d{2}))|(正午)))?", //5 prefix 6 hour 7 min 8 han 9 hh 10 mm 11 noon
  ].join(""),
  "g"
);

function jstIso(y, mo, d, h, mi) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(y, 4)}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+09:00`;
}

function validYmd(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function weekdayOf(y, mo, d) {
  return WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

/** テキスト中の日時表現をすべて拾う(NFKC済みの文字列を渡す)。 */
export function findDateTimes(text) {
  const out = [];
  DT_RE.lastIndex = 0;
  let m;
  while ((m = DT_RE.exec(text))) {
    if (m[0].length === 0) { DT_RE.lastIndex++; continue; }
    const raw = m[0].trim();
    const hasYear = !!m[1];
    const hasMonthKanji = /月/.test(raw);
    const hasTime = !!(m[6] || m[9] || m[11]);
    const hasWeekday = !!m[4];
    const hasDayKanji = /日/.test(raw.replace(/[(（][^)）]*[)）]/g, ""));
    // 「1/2」のような分数・比率を日付と誤認しない: 年・月/日の漢字・曜日・時刻のどれも無い場合は捨てる
    if (!hasYear && !hasMonthKanji && !hasDayKanji && !hasWeekday && !hasTime) continue;
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    let h = null, mi = null;
    const notes = [];
    if (m[11]) { h = 12; mi = 0; }
    else if (m[9]) { h = parseInt(m[9], 10); mi = parseInt(m[10], 10); }
    else if (m[6]) {
      h = parseInt(m[6], 10);
      mi = m[7] ? parseInt(m[7], 10) : m[8] ? 30 : 0;
      const pre = m[5];
      if (pre === "午後" || pre === "PM" || pre === "pm" || pre === "夜" || pre === "夕方" || pre === "夕") { if (h < 12) h += 12; }
      else if (pre === "午前" || pre === "AM" || pre === "am") { if (h === 12) h = 0; }
      // ひる/昼/朝: 数字をそのまま(ひる12時=12:00)
    }
    out.push({
      raw, index: m.index, end: m.index + m[0].length, year: hasYear ? parseInt(m[1], 10) : null,
      month: mo, day: d, weekday: m[4] || null, hour: h, minute: mi, hasTime, notes,
    });
  }
  return out;
}

/** findDateTimesの1件を、年を補って正規化する。年が無ければ iso=null。 */
export function resolveDateTime(dt, fallbackYear = null) {
  const notes = [...dt.notes];
  let year = dt.year;
  let inferred = false;
  if (year == null && fallbackYear != null) { year = fallbackYear; inferred = true; notes.push("年は同じ文中の開始日から引き継いだ(本文に年の記載なし)"); }
  if (year == null) return { raw: dt.raw, iso: null, date: null, timeUnconfirmed: !dt.hasTime, inferredYear: false, weekday: dt.weekday, notes: [...notes, "年が本文に無いため日付を確定しない"], reason: "NO_YEAR" };
  if (!validYmd(year, dt.month, dt.day)) return { raw: dt.raw, iso: null, date: null, timeUnconfirmed: !dt.hasTime, inferredYear: inferred, weekday: dt.weekday, notes: [...notes, "存在しない日付"], reason: "INVALID_DATE" };
  let y = year, mo = dt.month, d = dt.day;
  let h = dt.hour, mi = dt.minute;
  if (dt.hasTime) {
    if (h === 24 && mi === 0) {
      notes.push("24時は翌日0時として扱った");
      const next = new Date(Date.UTC(y, mo - 1, d + 1));
      y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate(); h = 0;
    } else if (h > 23 || mi > 59) {
      return { raw: dt.raw, iso: null, date: null, timeUnconfirmed: false, inferredYear: inferred, weekday: dt.weekday, notes: [...notes, "不正な時刻"], reason: "INVALID_TIME" };
    }
  }
  const date = `${String(year).padStart(4, "0")}-${String(dt.month).padStart(2, "0")}-${String(dt.day).padStart(2, "0")}`;
  return {
    raw: dt.raw,
    iso: dt.hasTime ? jstIso(y, mo, d, h, mi) : null,
    date,
    timeUnconfirmed: !dt.hasTime,
    inferredYear: inferred,
    weekday: dt.weekday,
    weekdayMatches: dt.weekday ? weekdayOf(year, dt.month, dt.day) === dt.weekday : null,
    notes,
    reason: null,
  };
}

const RANGE_TOKEN = /(?:〜|～|~|∼|から|ー|－|—|–|-)/;

/**
 * ラベル(例: 応募期間)に続く期間を解釈する。
 * 戻り値: { found:false } | { found:true, raw, start, end, deadlineOnly, status, notes }
 * status: CONFIRMED(両端が本文の年付きで確定) / INFERRED(年を引き継いだ) / UNCONFIRMED(確定できない)
 */
export function parsePeriodAfterLabel(text, labelRe, window = 170) {
  const lm = new RegExp(labelRe).exec(text);
  if (!lm) return { found: false };
  const from = lm.index + lm[0].length;
  const seg = text.slice(from, from + window).split("\n")[0];
  const dts = findDateTimes(seg);
  const raw = `${lm[0]}${seg}`.trim();
  if (dts.length === 0) return { found: true, raw, start: null, end: null, deadlineOnly: false, status: "UNCONFIRMED", notes: ["日時の表現を解釈できなかった(原文のみ保持)"] };
  const first = dts[0];
  const second = dts[1] || null;
  const between = second ? seg.slice(first.end, second.index) : "";
  const afterFirst = seg.slice(first.end, first.end + 6);
  if (second && RANGE_TOKEN.test(between)) {
    const start = resolveDateTime(first);
    const end = resolveDateTime(second, start.date ? parseInt(start.date.slice(0, 4), 10) : null);
    const inferred = end.inferredYear;
    const ok = !!(start.date && end.date);
    return {
      found: true, raw, start, end, deadlineOnly: false,
      status: !ok ? "UNCONFIRMED" : inferred ? "INFERRED" : "CONFIRMED",
      notes: [...(start.notes || []), ...(end.notes || [])],
    };
  }
  // 「…まで」だけ(締切のみ)
  if (/^\s*(?:頃)?\s*まで/.test(afterFirst) || /まで/.test(seg.slice(first.end, first.end + 4))) {
    const end = resolveDateTime(first);
    return { found: true, raw, start: null, end, deadlineOnly: true, status: end.date ? "CONFIRMED" : "UNCONFIRMED", notes: end.notes || [] };
  }
  // 単独の日時(当選発表など)
  const single = resolveDateTime(first);
  const approx = /^\s*頃/.test(seg.slice(first.end, first.end + 3));
  return { found: true, raw, start: single, end: null, deadlineOnly: false, single: true, approximate: approx, status: single.date ? "CONFIRMED" : "UNCONFIRMED", notes: [...(single.notes || []), ...(approx ? ["「頃」の記載あり(おおよその日時)"] : [])] };
}

export function jstNowParts(now) {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
  return f.replace(" ", "T") + "+09:00";
}

/** 日本時間の締切等と現在時刻の比較用(isoがnullなら null)。 */
export function isoToMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
