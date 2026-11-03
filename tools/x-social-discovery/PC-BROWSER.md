# X候補取得：PC Chrome試験版

対象: pokecamatomeru / pokecasokuhou / lifeprep_list。

既存の START-PC-COLLECTION.cmd で更新して起動すると、Amazon確認の前に実行します。既存のJST日別実行制限内で動作し、Windows自動起動の登録は追加しません。日次実行済みなら翌日まで再実行しません。

必要: PC版Chrome、Node 22以上、Playwright、GitとGitHub CLIの認証。Chrome専用プロファイルは LOCALAPPDATA/PokemonRadarCollector/x-chrome-profile に保存します。普段のChromeのCookie・認証情報はコピーしません。初回は未ログインで表示された投稿を読みます。ログイン操作の自動化はありません。

取得範囲: 各プロフィールで最初に描画された最大20記事のみ。表示できる投稿が少ない、古い固定投稿、本文省略、短縮URLの未展開があり、全投稿を網羅する監視ではありません。カーソルを進めず、毎回表示された候補をASINと出典で重複排除します。ブラウザ制限・ログイン要求で記事を取得できなければ失敗を記録し、前回候補を保持します。

出力: data/internal/x-browser-status.json にアカウント別取得件数と取得範囲、x-candidates.json に確認候補、amazon-asin-pool.json にASINを保存します。候補URLは広告パラメータを除去し、本文と元のアフィリエイトURLは新規保存しません。解決できない短縮リンクは要確認です。Amazon詳細確認前の候補をsnapshotへ公開しません。

2026-11-03: 検証用クラウドChromeで3プロフィールの表示とリンクの読み取りを確認。専用PC ChromeでのPlaywright実取得、利用者Windowsへの適用、定時無人運転は未確認。検証用ブラウザの結果はPC実行成功の証拠ではありません。
