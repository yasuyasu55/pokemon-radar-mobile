# X候補の取り込みとリンク正規化

X投稿取得そのものは既存PC collector側の作業です。この処理は取得済み投稿JSONを受け取り、検証前の候補を出力します。公開snapshotは変更しません。

入力例:

```json
{"posts":[{"handle":"example","postUrl":"https://x.com/example/status/123","postedAt":"2026-10-14T01:00:00Z","text":"招待受付 https://www.amazon.co.jp/dp/B0GP9QHQ3Y?tag=example","urls":[]}]}
```

```sh
node tools/x-social-discovery/import-posts.mjs posts.json output
# 短縮URLのネットワーク展開も行う場合
node tools/x-social-discovery/import-posts.mjs posts.json output --resolve
node --test tests/x-social-discovery.test.mjs tests/x-links.test.mjs
```

`x-candidates.json`にはAmazon・公式URL候補・要確認リンクが入ります。`amazon-watch-candidates.json`は既存Amazon batch形式の候補入力です。PC版に実際に読み込まれるかは未確認です。Amazon商品詳細でREQUESTABLEを確認するまで公開不可です。

AmazonはASINから広告タグのないURLを再構築します。t.co/amzn.to/link.amazonは最大5回まで、リダイレクト先を毎回確認します。楽天広告リンクはpc/mの遷移先を取り出し、対応公式ページのutm_*等のみ削除します。応募パラメータは保持します。未対応ホスト・失敗・ループは要確認です。対応公式ホストの一覧はnormalize-links.mjsで管理します。

同一ASINは統合し、各投稿のアカウント・日時・元リンクは残します。当選通知に含まれるURLも未検証候補として取り込み、受付開始とは判定しません。投稿本文のみのASIN、商品名検索、先行発見率の集計、PC collectorへの自動接続は未実装です。

追加アカウントは提供調査に基づく試験設定であり、独立した現況確認済みという意味ではありません。新規追加4件は無効のまま保持しています。
