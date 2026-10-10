// 取得工程。実取得は node:https を直接使い、毎回新しい接続(keepAliveなし)・Cookieなし・キャッシュ無効ヘッダーで行う。
// 許可ホスト以外へのリダイレクトは追わない。403/429等は回避せず、そのまま記録する。
import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import crypto from "node:crypto";

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const KEEP_HEADERS = ["date", "etag", "last-modified", "cache-control", "age", "content-type", "content-length", "content-encoding", "server", "via", "x-cache", "cf-cache-status", "expires", "location"];

export function checkUrlAllowed(rawUrl, allowedHosts, { allowInsecureHttp = false } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "URLとして解釈できない" }; }
  if (u.protocol !== "https:" && !(allowInsecureHttp && u.protocol === "http:")) return { ok: false, reason: `許可されないスキーム: ${u.protocol}` };
  if (!allowedHosts.includes(u.hostname)) return { ok: false, reason: `許可されていないホスト: ${u.hostname}` };
  if (u.username || u.password) return { ok: false, reason: "認証情報を含むURL" };
  return { ok: true, url: u };
}

function classifyError(err) {
  const code = err && err.code ? String(err.code) : "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || err?.message === "timeout") return "TIMEOUT";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH") return "CONNECT";
  if (/CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/.test(code) || /certificate|TLS|SSL/i.test(err?.message || "")) return "TLS";
  return "OTHER";
}

function oneHop(u, { timeoutMs, maxBytes, userAgent }) {
  return new Promise((resolve) => {
    const lib = u.protocol === "https:" ? https : http;
    const agent = new lib.Agent({ keepAlive: false, maxSockets: 1 });
    const started = Date.now();
    let socketInfo = {};
    const req = lib.request(u, {
      method: "GET", agent, timeout: timeoutMs,
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "Accept-Language": "ja,en;q=0.5",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Connection: "close",
      },
    }, (res) => {
      const chunks = [];
      let total = 0;
      let tooLarge = false;
      const declared = parseInt(res.headers["content-length"] || "", 10);
      if (Number.isFinite(declared) && declared > maxBytes) { tooLarge = true; req.destroy(); }
      res.on("data", (c) => {
        total += c.length;
        if (total > maxBytes) { tooLarge = true; req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => finish({ status: res.statusCode, res, body: Buffer.concat(chunks), tooLarge }));
      res.on("error", (e) => finish({ error: e }));
      res.on("close", () => { if (tooLarge) finish({ status: res.statusCode, res, body: Buffer.concat(chunks), tooLarge: true }); });
      socketInfo = { remoteAddress: res.socket?.remoteAddress || null, remotePort: res.socket?.remotePort || null, localPort: res.socket?.localPort || null };
    });
    let done = false;
    function finish(r) {
      if (done) return; done = true;
      agent.destroy();
      resolve({ ...r, durationMs: Date.now() - started, socketInfo });
    }
    req.on("timeout", () => { req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })); });
    req.on("error", (e) => finish({ error: e }));
    req.end();
  });
}

function decodeContent(body, encoding) {
  const enc = (encoding || "").toLowerCase();
  try {
    if (enc === "gzip") return zlib.gunzipSync(body);
    if (enc === "deflate") return zlib.inflateSync(body);
    if (enc === "br") return zlib.brotliDecompressSync(body);
  } catch { return null; }
  return body;
}

/** 本番用の取得関数。戻り値は常に同じ形(例外を投げない)。 */
export function createHttpsFetcher({ allowedHosts, timeoutMs = 15000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3, userAgent, allowInsecureHttp = false }) {
  return async function fetchOnce(rawUrl) {
    const startedAt = new Date().toISOString();
    const redirects = [];
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const chk = checkUrlAllowed(current, allowedHosts, { allowInsecureHttp });
      if (!chk.ok) {
        return { ok: false, requestedUrl: rawUrl, finalUrl: current, startedAt, status: null, errorKind: hop === 0 ? "URL_NOT_ALLOWED" : "REDIRECT_BLOCKED", error: chk.reason, redirects, headers: {}, bytes: 0, sha256: null, body: null, durationMs: 0, socket: {} };
      }
      const r = await oneHop(chk.url, { timeoutMs, maxBytes, userAgent });
      if (r.error) {
        return { ok: false, requestedUrl: rawUrl, finalUrl: current, startedAt, status: null, errorKind: classifyError(r.error), error: `${r.error.code || ""} ${r.error.message || ""}`.trim(), redirects, headers: {}, bytes: 0, sha256: null, body: null, durationMs: r.durationMs, socket: r.socketInfo };
      }
      const headers = {};
      for (const k of KEEP_HEADERS) if (r.res.headers[k] !== undefined) headers[k] = String(r.res.headers[k]);
      // Set-Cookie 等は保存しない(ヘッダーの許可リスト方式)
      const status = r.status;
      if (status >= 300 && status < 400 && r.res.headers.location) {
        redirects.push({ from: current, status, to: String(r.res.headers.location) });
        try { current = new URL(String(r.res.headers.location), current).toString(); } catch { return { ok: false, requestedUrl: rawUrl, finalUrl: current, startedAt, status, errorKind: "REDIRECT_BLOCKED", error: "不正なリダイレクト先", redirects, headers, bytes: 0, sha256: null, body: null, durationMs: r.durationMs, socket: r.socketInfo }; }
        continue;
      }
      if (r.tooLarge) return { ok: false, requestedUrl: rawUrl, finalUrl: current, startedAt, status, errorKind: "TOO_LARGE", error: `応答が${maxBytes}バイトを超えた`, redirects, headers, bytes: 0, sha256: null, body: null, durationMs: r.durationMs, socket: r.socketInfo };
      const decoded = decodeContent(r.body, headers["content-encoding"]);
      if (!decoded) return { ok: false, requestedUrl: rawUrl, finalUrl: current, startedAt, status, errorKind: "OTHER", error: "圧縮の展開に失敗", redirects, headers, bytes: r.body.length, sha256: sha256(r.body), body: null, durationMs: r.durationMs, socket: r.socketInfo };
      const ok = status >= 200 && status < 300;
      return {
        ok, requestedUrl: rawUrl, finalUrl: current, startedAt, status,
        errorKind: ok ? null : "HTTP_STATUS", error: ok ? null : `HTTP ${status}`,
        redirects, headers, bytes: decoded.length, sha256: sha256(decoded), body: decoded,
        durationMs: r.durationMs, socket: r.socketInfo,
      };
    }
    return { ok: false, requestedUrl: rawUrl, finalUrl: current, startedAt, status: null, errorKind: "REDIRECT_BLOCKED", error: `リダイレクトが${maxRedirects}回を超えた`, redirects, headers: {}, bytes: 0, sha256: null, body: null, durationMs: 0, socket: {} };
  };
}

// ---- robots.txt(最小限。*グループと自分のUA名のグループだけ見る) ------------------
export function parseRobots(body, uaToken) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) { lastWasAgent = false; continue; }
    const m = /^([A-Za-z\-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === "allow" || key === "disallow") cur.rules.push({ allow: key === "allow", path: val });
      else if (key === "crawl-delay") { const n = parseFloat(val); if (Number.isFinite(n)) cur.crawlDelay = n; }
    }
  }
  const token = (uaToken || "").toLowerCase();
  const specific = groups.filter((g) => token && g.agents.some((a) => a !== "*" && token.includes(a)));
  const star = groups.filter((g) => g.agents.includes("*"));
  const used = specific.length ? specific : star;
  return { groups: used.length, rules: used.flatMap((g) => g.rules), crawlDelay: used.map((g) => g.crawlDelay).find((x) => x != null) ?? null };
}

export function isPathAllowed(robots, pathWithQuery) {
  let best = null;
  for (const r of robots.rules) {
    if (r.path === "") continue; // 空のDisallowは「全許可」
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(pathWithQuery)) {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}
