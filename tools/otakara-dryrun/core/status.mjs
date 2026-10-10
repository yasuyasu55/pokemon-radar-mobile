// 実行環境の判別と、終了コードの決め方(純粋関数。ファイル・ネットワークに触れない)。
export const TOOL_ID = "otakara-dryrun/0.2";
export const EXTRACTOR_VERSION = "2"; // 見出し→後続行・ブランド別店舗に対応した版。比較時、版が違えば抽出値の差は比較しない

/** 実行環境の判別。GitHub Actions は GITHUB_ACTIONS=true。ユーザー名・フォルダ名・リポジトリ名は記録しない。 */
export function detectRunner(env = {}, platform = "linux", arch = "x64") {
  if (env.GITHUB_ACTIONS === "true") {
    return {
      kind: "GITHUB_ACTIONS",
      label: `GitHub Actions(${env.RUNNER_OS || "Linux"} ${env.RUNNER_ARCH || arch}${env.ImageOS ? `・イメージ ${env.ImageOS}` : ""})`,
      details: { runnerOs: env.RUNNER_OS || null, runnerArch: env.RUNNER_ARCH || null, imageOs: env.ImageOS || null, imageVersion: env.ImageVersion || null, workflow: env.GITHUB_WORKFLOW || null, runId: env.GITHUB_RUN_ID || null, runAttempt: env.GITHUB_RUN_ATTEMPT || null, sha: env.GITHUB_SHA || null, ref: env.GITHUB_REF_NAME || null, event: env.GITHUB_EVENT_NAME || null },
    };
  }
  if (platform === "win32") return { kind: "WINDOWS_LOCAL", label: "Windows PC(ローカル実行)", details: {} };
  return { kind: "OTHER_LOCAL", label: `ローカル実行(${platform} ${arch})`, details: {} };
}

/** 旧版の結果(runner 記録なし)も判別する。 */
export function runnerLabelOf(result) {
  const re = result?.env?.mode === "REANALYSIS" ? "・保存本文の再解析" : "";
  if (result?.env?.runner?.label) return result.env.runner.label + re;
  if (result?.env?.platform === "win32") return (re ? "Windows PC(ローカル実行)" : "Windows PC(ローカル実行・旧版の記録)") + re;
  return result?.env?.platform ? `ローカル実行(${result.env.platform})` : "実行環境不明";
}

export const EXIT = { OK: 0, FETCH_FAILED: 10, EXTRACTION_INCOMPLETE: 20, COMPARE_DIFFERS: 30, TOOL_ERROR: 99 };
const FETCH_OK_VERDICTS = ["OK", "NO_CANDIDATE_IN_LIST"];

/** 1回分の結果の終了コード。取得失敗は非0。取得が成功しても、抽出が不完全なら 20。 */
export function exitCodeOfRun(result) {
  if (!result) return EXIT.TOOL_ERROR;
  if (result.verdict === "TOOL_ERROR") return EXIT.TOOL_ERROR;
  if (!FETCH_OK_VERDICTS.includes(result.verdict)) return EXIT.FETCH_FAILED;
  if (result.extractionVerdict && result.extractionVerdict.level === "INCOMPLETE") return EXIT.EXTRACTION_INCOMPLETE;
  return EXIT.OK;
}

/** 全体処理: 取得結果(各回)→2回の比較→抽出の完全性の順に、重い問題を優先して返す。 */
export function exitCodeOfAll({ results, compare, compareFailed = false }) {
  const codes = results.map(exitCodeOfRun);
  if (codes.includes(EXIT.TOOL_ERROR) || compareFailed) return EXIT.TOOL_ERROR;
  if (codes.includes(EXIT.FETCH_FAILED)) return EXIT.FETCH_FAILED;
  if (compare && compare.overall !== "CONSISTENT") return EXIT.COMPARE_DIFFERS;
  if (codes.includes(EXIT.EXTRACTION_INCOMPLETE)) return EXIT.EXTRACTION_INCOMPLETE;
  return EXIT.OK;
}

export function exitMeaning(code) {
  return ({ 0: "取得・抽出・比較とも問題なし", 10: "取得に失敗(または一部失敗・アクセス不可)", 20: "取得は成功したが、抽出に未確認の必須項目あり", 30: "取得は成功したが、2回の比較に差あり", 99: "ツールの異常(結果が作れなかった等)" })[code] || "不明";
}
