// 使い方(Windows では RUN-OTAKARA-DRYRUN.cmd のダブルクリックだけ。GitHub Actions では .github/workflows/otakara-dryrun.yml から):
//   node cli.mjs all                    ... 独立2回の取得 → 比較 → 結果の保存(ZIP) → (Windowsのみ)フォルダを開く
//   node cli.mjs run --n 1 --out DIR    ... 1回分
//   node cli.mjs compare --out DIR / pack --out DIR
//   node cli.mjs reanalyze --result 元のresult.json --bodies 保存本文の場所 --out 出力.json   ... 保存本文の再解析(新しい実取得ではない)
//   node cli.mjs compare-env --a 結果1 --b 結果2 [--out DIR]   ... 別の環境で取得した結果どうしの比較(result.json / 結果フォルダ / 結果ZIP)
// オプション: --base DIR 保存先 / --profile github|windows 実行環境の表示を固定 / --no-bodies 本文・生HTMLを保存しない
//             --reference FILE 比較対象の結果(Windowsの結果など) / --replay-dir DIR 開発用: 保存済みHTMLの再生(実取得ではない)
// 終了コード: 0 問題なし / 10 取得失敗 / 20 抽出が不完全 / 30 2回の比較に差 / 99 ツール異常
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHttpsFetcher, sha256 } from "./core/http.mjs";
import { runPipeline } from "./core/pipeline.mjs";
import { compareRuns, compareEnvironments } from "./core/compare.mjs";
import { renderRunReport, renderCompareReport, renderCrossEnvReport } from "./core/report.mjs";
import { buildZip, readZip } from "./core/zip.mjs";
import { reanalyzeSavedBodies } from "./core/reanalyze.mjs";
import { detectRunner, runnerLabelOf, exitCodeOfRun, exitCodeOfAll, exitMeaning, TOOL_ID, EXTRACTOR_VERSION, EXIT } from "./core/status.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(fs.readFileSync(path.join(here, "core", "source.otakarasouko.json"), "utf8"));

const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 18) { console.error(`Node.js 18以上が必要です(現在 ${process.version})。`); process.exit(2); }

function arg(name, def = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
function flag(name) { return process.argv.includes(`--${name}`); }
function stampNow() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function defaultBase() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "PokemonRadar", "dryrun");
}
function runner() {
  const prof = arg("profile");
  if (prof === "github") return detectRunner({ ...process.env, GITHUB_ACTIONS: "true" }, process.platform, process.arch);
  if (prof === "windows") return detectRunner({ ...process.env, GITHUB_ACTIONS: "false" }, "win32", process.arch);
  return detectRunner(process.env, process.platform, process.arch);
}
const replayDir = () => arg("replay-dir");
/** GitHub Actions では本文・生HTMLを成果物に残さない(--no-bodies が既定相当)。 */
const slim = () => flag("no-bodies") || runner().kind === "GITHUB_ACTIONS";
function envInfo() {
  return {
    node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, pid: process.pid,
    processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    runner: runner(), mode: replayDir() ? "REPLAY" : "LIVE", bodiesSaved: !slim(),
  };
}
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8"); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

// 開発用: 保存済みHTMLの再生。robots.txt / list.html / otakarasouko-<id>.html を読む。実取得ではない(env.mode=REPLAY と表示される)。
function replayFetcher(dir) {
  const fileFor = (u) => {
    if (u.pathname === "/robots.txt") return "robots.txt";
    if (u.pathname === "/new_information/") return "list.html";
    const m = /^\/information\/(\d+)\/?$/.exec(u.pathname);
    return m ? `otakarasouko-${m[1]}.html` : null;
  };
  return async (url) => {
    const u = new URL(url);
    const name = fileFor(u);
    const f = name ? path.join(dir, name) : null;
    const base = { requestedUrl: url, finalUrl: url, startedAt: new Date().toISOString(), redirects: [], durationMs: 0, socket: {} };
    if (!f || !fs.existsSync(f)) return { ...base, ok: false, status: 404, errorKind: "HTTP_STATUS", error: "HTTP 404(再生用ファイルなし)", headers: {}, bytes: 0, sha256: null, body: null };
    const body = fs.readFileSync(f);
    return { ...base, ok: true, status: 200, errorKind: null, error: null, headers: { "content-type": name === "robots.txt" ? "text/plain" : "text/html; charset=utf-8" }, bytes: body.length, sha256: sha256(body), body };
  };
}

async function cmdRun(n, out) {
  const replay = replayDir();
  const fetcher = replay ? replayFetcher(replay) : createHttpsFetcher({ allowedHosts: source.allowedHosts, ...source.limits, userAgent: source.userAgent });
  console.log(`[run ${n}] ${replay ? "保存済みHTMLの再生を開始します(実取得ではありません)" : "取得を開始します(通常HTTP・ブラウザ不使用)"}...`);
  let result, bodies;
  try {
    ({ result, bodies } = await runPipeline({ source, fetcher, runLabel: `run-${n}`, env: envInfo(), ...(replay ? { sleep: async () => {} } : {}) }));
  } catch (e) {
    // 想定外の例外でも、失敗として結果に残す(案件0件とは扱わない)
    result = {
      schemaVersion: "otakara-dryrun-candidates/1", tool: TOOL_ID, extractorVersion: EXTRACTOR_VERSION, runLabel: `run-${n}`, source: { sourceId: source.sourceId, displayName: source.displayName, listUrl: source.listUrl },
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), env: envInfo(), verdict: "TOOL_ERROR", verdictDetail: `ツール内部の例外: ${String(e && e.message || e)}`,
      extractionVerdict: { level: "NOT_EVALUATED", detail: "ツール異常のため評価していない" },
      stages: [], ledger: [], failures: [{ stage: "tool", url: source.listUrl, errorKind: "EXCEPTION", error: String(e && e.stack || e).slice(0, 2000) }],
      list: null, candidates: [], counts: { candidates: null, detailAttempted: 0, detailFailed: 0 }, notes: ["candidates=null は『0件』ではなく『判定できなかった』を意味する。"],
    };
    bodies = {};
  }
  const dir = path.join(out, `run-${n}`);
  // 失敗した回でも、結果とレポートは必ず保存する
  writeJson(path.join(dir, "result.json"), result);
  fs.writeFileSync(path.join(dir, "report.md"), renderRunReport(result), "utf8");
  if (!slim()) for (const [name, text] of Object.entries(bodies)) { fs.mkdirSync(path.join(dir, "bodies"), { recursive: true }); fs.writeFileSync(path.join(dir, "bodies", name), text, "utf8"); }
  console.log(`[run ${n}] 取得工程: ${result.verdict} / 抽出の完全性: ${result.extractionVerdict ? result.extractionVerdict.level : "未評価"} / 候補: ${result.counts.candidates === null ? "判定不能" : result.counts.candidates + "件"}`);
  return result;
}

function cmdCompare(out) {
  const a = readJson(path.join(out, "run-1", "result.json"));
  const b = readJson(path.join(out, "run-2", "result.json"));
  const c = compareRuns(a, b);
  writeJson(path.join(out, "compare.json"), c);
  fs.writeFileSync(path.join(out, "compare.md"), renderCompareReport(c), "utf8");
  console.log(`[compare] ${c.overall}`);
  return c;
}

/** result.json / 結果フォルダ(run-1/result.json) / 結果ZIP のいずれからでも読む。 */
function loadResultFrom(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    const f = [path.join(p, "run-1", "result.json"), path.join(p, "result.json")].find((x) => fs.existsSync(x));
    if (!f) throw new Error(`result.json が見つかりません: ${p}`);
    return readJson(f);
  }
  if (/\.zip$/i.test(p)) {
    const ent = readZip(fs.readFileSync(p)).find((e) => /(^|\/)run-1\/result\.json$/.test(e.name));
    if (!ent) throw new Error("ZIP内に run-1/result.json がありません");
    return JSON.parse(ent.data.toString("utf8"));
  }
  return readJson(p);
}

function cmdCompareEnv(aPath, bPath, out) {
  const c = compareEnvironments(loadResultFrom(aPath), loadResultFrom(bPath));
  if (out) {
    writeJson(path.join(out, "cross-env.json"), c);
    fs.writeFileSync(path.join(out, "cross-env.md"), renderCrossEnvReport(c), "utf8");
  }
  console.log(`[compare-env] ${c.overall}: ${c.a.label} ↔ ${c.b.label}`);
  return c;
}

function listFiles(dir, rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listFiles(dir, r)); else out.push(r);
  }
  return out;
}

function cmdPack(out, extra = {}) {
  const runs = [1, 2].filter((n) => fs.existsSync(path.join(out, `run-${n}`, "result.json"))).map((n) => readJson(path.join(out, `run-${n}`, "result.json")));
  const comp = fs.existsSync(path.join(out, "compare.json")) ? readJson(path.join(out, "compare.json")) : null;
  const cross = fs.existsSync(path.join(out, "cross-env.json")) ? readJson(path.join(out, "cross-env.json")) : null;
  const sl = slim();
  const label = runs[0] ? runnerLabelOf(runs[0]) : runner().label;
  const replay = runs.some((r) => r.env && r.env.mode === "REPLAY");
  const L = [];
  L.push("# お宝創庫 dry-run 結果のまとめ");
  L.push("");
  if (replay) L.push("**この結果は保存済みHTMLの再生(開発用)です。実取得ではありません。**");
  else L.push(`この結果は、**${label}から通常HTTP(ブラウザ不使用)で実際に取得した結果**です。人工データのテスト結果・要約取得ツールでの確認とは別物です。`);
  L.push("取得できた/できなかった、抽出できた/できなかった項目をそのまま記録しています。失敗は『案件0件』として扱っていません。");
  L.push("");
  runs.forEach((r) => L.push(`- ${r.runLabel}: 取得工程 **${r.verdict}** ／ 抽出の完全性 **${r.extractionVerdict ? r.extractionVerdict.level : "未評価"}**${r.extractionVerdict && r.extractionVerdict.missing && r.extractionVerdict.missing.length ? `(未確認: ${r.extractionVerdict.missing.join("、")})` : ""} ／ 候補 ${r.counts.candidates === null ? "判定不能" : r.counts.candidates + "件"} ／ 失敗 ${r.failures.length}件`));
  L.push("- ※取得工程が OK でも、抽出の完全性が COMPLETE でなければ完成とは判断しません。");
  if (comp) L.push(`- 2回の比較: **${comp.overall}**(詳細は compare.md)`);
  else L.push("- 2回の比較: **未実施または失敗**(compare-error.txt を参照)");
  if (cross) L.push(`- 別環境との比較: **${cross.overall}** — ${cross.overallDetail}(${cross.a.label} ↔ ${cross.b.label}。詳細は cross-env.md)`);
  if (extra.exitCode !== undefined) L.push(`- 終了コード: **${extra.exitCode}** — ${exitMeaning(extra.exitCode)}`);
  if (extra.runExitCodes) L.push(`- 各回の終了コード: ${extra.runExitCodes.join(", ")}`);
  L.push("");
  L.push("## 含まれるもの");
  L.push("- run-1 / run-2: result.json(通信の記録・抽出値・根拠の抜粋・検証結果)、report.md");
  if (sl) L.push("- 取得したHTMLや本文(bodies)は**保存していません**(成果物に生HTMLを残さない設定)");
  else L.push("- bodies(取得した公開ページ。メール・電話番号らしき文字列は伏せ字)");
  L.push("- compare.json / compare.md: 2回の比較(ハッシュが違っても、本文の変更と抽出結果の差を分けて判断)");
  L.push("- 含まれないもの: Cookie、認証情報、ユーザー名・フォルダ名、本番DB、アプリのファイル");
  const summary = L.join("\n") + "\n";
  fs.writeFileSync(path.join(out, "SUMMARY.md"), summary, "utf8");
  const files = listFiles(out).filter((f) => !f.endsWith(".zip") && !(sl && /(^|\/)bodies\//.test(f)));
  const entries = files.map((f) => ({ name: `otakara-dryrun-result/${f}`, data: fs.readFileSync(path.join(out, f)) }));
  const zipPath = path.join(path.dirname(out), `otakara-dryrun-result-${path.basename(out).replace(/^otakara-/, "")}.zip`);
  fs.writeFileSync(zipPath, buildZip(entries));
  console.log(`[pack] ${zipPath}`);
  return zipPath;
}

function openFolderSelecting(file) {
  if (process.platform !== "win32" || runner().kind === "GITHUB_ACTIONS" || flag("no-open")) return;
  try { spawn("explorer.exe", [`/select,${file}`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref(); } catch { /* 開けなくても結果は保存済み */ }
}

const crashedResult = (n) => ({ verdict: "TOOL_ERROR", runLabel: `run-${n}`, extractionVerdict: { level: "NOT_EVALUATED" }, counts: { candidates: null }, failures: [{ stage: "tool", errorKind: "NO_RESULT", error: "result.json が作られなかった" }], env: {} });

async function cmdAll() {
  const base = arg("base", defaultBase());
  let out = path.join(base, `otakara-${stampNow()}`);
  try { fs.mkdirSync(out, { recursive: true }); } catch { out = path.join(os.tmpdir(), `otakara-${stampNow()}`); fs.mkdirSync(out, { recursive: true }); }
  console.log(`お宝創庫 dry-run を開始します(実行環境: ${runner().label})。本番DB・アプリには触れません。`);
  const gap = parseInt(arg("gap-seconds", "20"), 10);
  const passthru = ["--profile", "--replay-dir"].flatMap((k) => (arg(k.slice(2)) ? [k, arg(k.slice(2))] : [])).concat(flag("no-bodies") ? ["--no-bodies"] : []);
  const codes = [];
  for (const n of [1, 2]) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "run", "--n", String(n), "--out", out, ...passthru], { stdio: "inherit" });
    codes.push(r.status);
    if (n === 1) { console.log(`${gap}秒待ってから、新しいプロセスで2回目を取得します...`); await new Promise((res) => setTimeout(res, gap * 1000)); }
  }
  const results = [1, 2].map((n) => { try { return readJson(path.join(out, `run-${n}`, "result.json")); } catch { return crashedResult(n); } });
  let compare = null;
  let compareFailed = false;
  try { compare = cmdCompare(out); } catch (e) { compareFailed = true; console.error("[compare] 失敗:", e.message); fs.writeFileSync(path.join(out, "compare-error.txt"), String(e && e.stack || e), "utf8"); }
  const ref = arg("reference");
  if (ref) {
    try { cmdCompareEnv(path.join(out, "run-1", "result.json"), ref, out); } catch (e) { console.error("[compare-env] 失敗:", e.message); fs.writeFileSync(path.join(out, "cross-env-error.txt"), String(e && e.stack || e), "utf8"); }
  }
  const code = exitCodeOfAll({ results, compare, compareFailed });
  const zip = cmdPack(out, { runExitCodes: codes, exitCode: code });
  openFolderSelecting(zip);
  console.log("");
  console.log("=== 結果 ===");
  results.forEach((r) => console.log(`${r.runLabel}: 取得工程 ${r.verdict} / 抽出の完全性 ${r.extractionVerdict ? r.extractionVerdict.level : "未評価"}`));
  console.log(`2回の比較: ${compare ? compare.overall : "失敗"}`);
  console.log(`終了コード ${code}: ${exitMeaning(code)}`);
  console.log(`結果の保存先: ${zip}`);
  return code;
}

async function cmdReanalyze() {
  const resultPath = arg("result"), bodiesDir = arg("bodies"), outPath = arg("out");
  const original = readJson(resultPath);
  const r = await reanalyzeSavedBodies({ source, original, readBody: (name) => { const f = path.join(bodiesDir, name); return fs.existsSync(f) ? fs.readFileSync(f) : null; } });
  writeJson(outPath, r);
  console.log(`[reanalyze] 保存本文の再解析(実取得ではない): 抽出の完全性 ${r.extractionVerdict.level} / 候補 ${r.counts.candidates}件 → ${outPath}`);
  console.log(`[reanalyze] 本文テキストが元の実取得と一致: ${JSON.stringify(r.reanalysis.normalizedTextMatchesOriginal)}`);
}

const cmd = process.argv[2] || "all";
try {
  if (cmd === "all") process.exitCode = await cmdAll();
  else if (cmd === "run") { const r = await cmdRun(parseInt(arg("n", "1"), 10), arg("out")); process.exitCode = exitCodeOfRun(r); }
  else if (cmd === "compare") cmdCompare(arg("out"));
  else if (cmd === "reanalyze") await cmdReanalyze();
  else if (cmd === "compare-env") cmdCompareEnv(arg("a"), arg("b"), arg("out"));
  else if (cmd === "pack") cmdPack(arg("out"));
  else { console.error("unknown command"); process.exitCode = 2; }
} catch (e) {
  console.error("予期しないエラー:", e && e.stack || e);
  process.exitCode = EXIT.TOOL_ERROR;
}
