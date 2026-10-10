// 送付用に保存する本文から、メールアドレス・電話番号・Cookie/トークンらしき値を伏せる。
// 取得した応答そのもののSHA-256は台帳(ledger)に別途残す(マスク前の値)。公開ページが対象で、個人情報は含まない想定だが念のため。
export function maskSensitive(s) {
  return s
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, "[MASKED-EMAIL]")
    .replace(/(?<![\d])(?:0\d{1,4}[-‐ー−]\d{1,4}[-‐ー−]\d{3,4}|0\d{9,10})(?![\d])/g, "[MASKED-TEL]")
    .replace(/\b(?:sessionid|PHPSESSID|csrf[_-]?token|access[_-]?token|authorization)\s*[=:]\s*[^\s;"'<>]{6,}/gi, "[MASKED-SECRET]");
}
