# PC収集の自動実行

ENABLE-DAILY-PC-COLLECTION.cmd をWindowsで1回実行します。新しいタスク名は PokemonRadar-PC-Collector-Daily です。登録後の読み戻しに成功すると REGISTERED と表示します。PCの設定はこのファイルを実行するまで変更されません。

現在ユーザーのログイン時、または毎日09:15（Windows日本時間設定必須）に起動します。実際の取得は既存のJST日別ロックにより1日1回だけです。ログイン時にその日取得済みなら09:15は巡回しません。失敗日も自動再試行しません。PCの電源・ログインが必要で、スリープ解除や電源投入はしません。

コンソールは非表示ですが、X・Amazonのブラウザは表示します。以前のNext.js PC版本体・旧Publisherタスク・他のアプリは登録しません。既存タスクを起こす処理はありません。停止は DISABLE-DAILY-PC-COLLECTION.cmd でこのタスクだけを無効にします。同名の別タスクがあれば変更を拒否します。既存の同じタスクを更新する際はXMLを退避します。

ログ: LOCALAPPDATA/PokemonRadarCollector の daily-launcher.log / daily-output.log / daily-error.log / last-result.json。PowerShellポリシーは起動プロセスだけRemoteSignedを指定し、PC全体の設定は変更しません。登録直後に取得は開始しません。次の通常ログインでブラウザが開き、結果が更新されるまで実機確認は未完了です。

Xの改善: 本文の表示を待つ時間を90秒に増やし、ページ全体の読込完了を待つ代わりにドキュメント到達後の記事表示を待ちます。「さらに表示」ボタンだけのタイムアウトで取得済み記事を失わないようにしました。失敗時はNAVIGATE/WAIT_POSTS/READ等の段階を記録します。旧ログのTimeoutErrorだけでは停止段階を特定できないため、解消は実機で再確認が必要です。取得範囲は表示サンプルのままであり、全投稿監視ではありません。
