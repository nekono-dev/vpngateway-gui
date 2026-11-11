# 2026-11-11 都市選択完了・main マージ保留

この記録と `.kiro/specs/location-city-selection/acceptance-2026-11-11.md` は同日以前の E2E 記録を更新する最新の結果。

## スコープと結果

利用者が再開範囲を「都市選択の完了とマージ可否再評価まで」と指定。main の merge/push は実施していない。

- location-city-selection は小タスク31/31完了。7.2/7.3とも独立 kiro-review APPROVED、機能全体の要件・設計・境界監査も阻害なし。kiro-verify-completionで機能GOを確認。承認フラグは変更なし。
- 独立canonical検証: npm test 1,149件＋中立性/installer、build、E2E補助113件がすべて終了コード0。
- 最終製品コード/テストと検証サーバの変更対象全ファイルはSHA-256一致。検証用一時repo commit256dd2dの全群npm run test:e2eが終了コード0、lifecycle5/stack57/gateway17=79成功、unexpected/flaky0。既定診断オプション1skip。
- 390px CDP実touch、戻る実click/一階層swipe、両提供元都市お気に入り、サーバお気に入り、AdGuard切断→国名接続→削除→無通知、Proton CLI非実行エラー/保持、全国都市cache再計測、servercache保持、サーバ接続中badge更新をPlaywrightで確認。
- 最終成果物はGit管理外 `e2e/artifacts/hosted/2026-11-11-city-acceptance/final/`（JSON/tar/log/SHA/PNG）。親と独立reviewerがJSONと画像を確認。

## 修正

クリックのpointer capture、swipe後の二重戻り、touch-action、fallback成功トースト、実接続に追従するserverbadge、global都市cache破棄のUI配線、距離のshared formatDistance利用。RED→GREENの証拠と詳細は受入記録を参照。

## main 可否・残る作業

都市選択の機能としてはGOだが、そのままmainにマージすることは推奨しない。

- 変更は未コミット。選択git addを試みたがローカル.gitがread-onlyでindex.lock作成失敗。ステージング/commitなし。制限回避なし。
- ブランチには多段接続の基盤、作業ツリーには設定/cc-sdd導入/多段仕様等も混在。今回のレビューは都市選択範囲なので、Gitに書ける環境で取り込み範囲を整理してcommit内容を確認する必要がある。
- HEAD90af77f、remote main0763e7aは祖先、remote main比51commits先。ローカルmain参照は古いため比較にはremote mainのハッシュを使用。
- 多段接続は4/25のままで、今回残タスクは実装していない。

## 検証環境

192.168.3.240上のLXD `e2e-city-selection-20261110` はSTOPPED。再現用treeは `/workspace/vpngateway-gui`。再利用時はubuntuで実行（UIDルーティングを壊さない）、DHCP DNS個別経路を復活させない。sudo実行可能なnode、LXD proc/sys mount syscall interceptionを設定済み。検証サーバ本体の既存アプリは変更していない。
