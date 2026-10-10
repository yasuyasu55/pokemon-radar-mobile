// HTML→テキスト変換と、タイトル等の取り出し。依存ライブラリなし(GitHub Actionsでもそのまま動く)。
// 証拠(quote)は、ここで正規化(NFKC)したテキストから切り出す。原文HTMLは別途ハッシュで保持する。

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === "#") {
      const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, g) ? NAMED[g] : m;
  });
}

function stripBlocks(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

/** 記事本文の範囲(article → main → body → 全体)を返す。どれを使ったかも返す。 */
export function pickArticleScope(html) {
  const cleaned = stripBlocks(html);
  for (const [tag, label] of [["article", "article"], ["main", "main"], ["body", "body(fallback)"]]) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i");
    const m = cleaned.match(re);
    if (m && m[1].trim().length > 0) return { html: m[1], scope: label };
  }
  return { html: cleaned, scope: "whole(fallback)" };
}

export function htmlToText(html) {
  let s = stripBlocks(html);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|ul|ol|tr|table|h[1-6]|section|article|header|footer|dt|dd|blockquote|pre)\s*>/gi, "\n");
  s = s.replace(/<(p|div|li|tr|h[1-6]|dt|dd)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(td|th)\s*>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.normalize("NFKC");
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t 　]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

function textOf(fragment) {
  return htmlToText(fragment).replace(/\n+/g, " ").trim();
}

export function extractTitles(html) {
  const cleaned = stripBlocks(html);
  const h1 = cleaned.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  const title = cleaned.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  return {
    h1: h1 ? textOf(h1[1]) : null,
    title: title ? textOf(title[1]) : null,
    ogTitle: og ? decodeEntities(og[1]).normalize("NFKC").trim() : null,
  };
}

export function extractPublishedMeta(html) {
  const m1 = html.match(/<meta[^>]+property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i);
  if (m1) return { value: m1[1], source: "meta:article:published_time" };
  const m2 = html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
  if (m2) return { value: m2[1], source: "time[datetime]" };
  return null;
}

/** <a>のhrefと文字列(絶対URL化は呼び出し側)。 */
export function extractAnchors(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].match(/href\s*=\s*["']([^"']*)["']/i);
    if (!href) continue;
    out.push({ href: decodeEntities(href[1]).trim(), text: textOf(m[2]), index: m.index, endIndex: m.index + m[0].length, rawInner: m[2] });
  }
  return out;
}

export function charsetFromHtml(buf) {
  const head = buf.subarray(0, 4096).toString("latin1");
  const m = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_\-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

export function decodeBody(buf, contentType) {
  let cs = null;
  const ct = /charset\s*=\s*["']?([a-zA-Z0-9_\-]+)/i.exec(contentType || "");
  if (ct) cs = ct[1].toLowerCase();
  if (!cs) cs = charsetFromHtml(buf);
  if (!cs) cs = "utf-8";
  try {
    return { text: new TextDecoder(cs).decode(buf), charset: cs, charsetOk: true };
  } catch {
    return { text: new TextDecoder("utf-8").decode(buf), charset: cs, charsetOk: false };
  }
}
