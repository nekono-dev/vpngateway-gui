# 都市選択の受け入れ検証（2026-11-11 再開分）

## 対象

cc-sdd `kiro-impl` の 7.2 と 7.3。main へのマージ操作は実施しない。既存の未コミット変更は保持する。

## 検証で発見して修正した不具合

- 戻るボタンを通常クリックしても親要素の pointer capture により反応しない。捕捉先を操作開始要素に変更。
- 子ボタンからのスワイプ後に click も処理して二度戻り得る。スワイプで戻った直後のポインタ由来 click を抑制し、次の操作・キーボード操作は通す。
- 携帯の実タッチ右スワイプがブラウザの pan 処理で取り消される。戻る領域を `touch-action: pan-y` に設定。
- 一覧外サーバお気に入りの国名フォールバック成功時に通常の成功トーストが出る。接続後のお気に入り一覧で対象が削除されたことを確認して無通知とする。一覧が残る通常接続は成功通知を維持する。判定用再取得失敗を接続失敗として扱わず、通知を控えて状態を再取得する。

## RED / GREEN の根拠

- 修正前の実ブラウザ: 通常の戻るボタン `.click()` 後に都市一覧が表示されず失敗（`city-backbar-red2.log`）。従来の Enter 操作では検出できなかった。
- 単体: 子要素での捕捉の回帰テストは修正前に 1 failed / 8 passed。二重戻りの回帰テストは追加時に 1 failed / 9 passed。修正後は 10 passed。
- 修正前の実ブラウザ: MutationObserver が「接続先を変更しました×」を記録し、フォールバックの無通知要件で失敗。
- App 単体: 削除されたお気に入りが残り RED。修正後は削除・保持・再取得失敗を含む 23 件が成功。
- 修正前の実ブラウザ CDP touch: サーバ一覧で右スワイプ後も都市一覧が表示されず失敗（`city-touch-red2.log`）。
- 修正後の実ブラウザ focused: AdGuard の切断→Japan 国名接続→削除→無通知と、390px の実タッチによる Proton のサーバ→都市→国・AdGuard の都市→国が 2 passed、終了コード 0（`city-focused-final.log`）。

## 受け入れの観測

- 両提供元で都市お気に入りの登録・一覧からの選択・接続・切断。実ランナーの `exec_completed` で接続引数を確認。
- Proton のサーバお気に入りから指定サーバへの接続。
- 国→都市→サーバ、実クリックで戻る、戻るボタン上からの右スワイプが一階層だけ戻る、タブ保持、再計測。
- AdGuard の一覧外サーバお気に入りは接続中の画面から接続先を変更し、切断→国名接続を検証。UI/API の削除と操作期間中の無通知を確認。
- Proton の一覧外サーバお気に入りは接続・切断 CLI の実行件数が増えず、エラーになり、お気に入りが残ることを検証。
- 390×844、isMobile/hasTouch を指定した Chromium context と CDP `Input.dispatchTouchEvent` で実タッチ操作。独自 context でも JavaScript エラーを検査。
- 初回プロバイダ情報取得による key 付きセクションの再構成前に操作しないよう、UI のプロバイダ選択値が期待値になったことを待つ。固定 sleep や失敗後の再選択による救済はしない。

## 機械的検証と成果物

- 独立 reviewer による最終製品コードの `npm test`: 1,149 件、中立性検査、installer 試験、終了コード 0。
- `npm run build`: 終了コード 0。
- `npm run test:e2e-unit`: 113 件、終了コード 0。
- `git diff --check`: 成功。
- 成果物（Git 管理外）: `e2e/artifacts/hosted/2026-11-11-city-acceptance/`。focused の JSON・trace、390px のスクリーンショット 2 枚。親がスクリーンショットを目視確認。
- 最終全群 E2E・独立レビュー・機能全体の監査は完了。結果は末尾の完了判定を参照。

## 環境と範囲

検証サーバ 192.168.3.240 の専用 LXD `e2e-city-selection-20261110` を ubuntu ユーザーで使用。検証サーバ本体の既存アプリは変更しない。ネットワークは固定 IP にして DHCP の DNS 個別経路再追加を避ける。実 VPN の新たな接続試験ではなく、実アプリと模擬 CLI/ネットワークによる受け入れ検証。

## 全要件の照合で追加修正した統合不整合

- 要件 6.4: サーバ行の `connected` を前回接続先 ID から求めていたため、切断後にもバッジが残り得た。API は既存の接続状態 API を再利用して現在の status/location を参照し、フックは接続状態・接続先変更で同じ都市でも再取得する。状態取得失敗時に前回値を接続中としない。
- 要件 8.4 と location-distance-sort 4.3/4.4: 国・都市の行で距離表示を直接組み立てていた。既存の共有 `formatDistance` へ統一し、距離あり・0・距離なしを両行で検査。
- 要件 5.5: 通常 UI の再計測が国別の再取得だけを呼んでいた。全都市 refresh POST 成功後に現在の都市を GET し、その成功後だけ国一覧も再取得する。POST 失敗時に破棄成功として進めない。国別取得エラーの再試行は既存の経路を維持。
- 回帰の RED: server API 2 failed/4 passed、server hook 1 failed/1 passed、再計測 2 failed/3 passed、距離表示 4 failed/9 passed。
- 機能全体の監査で要件1〜8を実装・テストへ対応付け、上記3件以外に具体的な境界逸脱・仕様阻害は発見されなかった。距離計算は既存の distance-sort へ委ね、プロバイダ差分は宣言に保持する。多段接続への依存を追加しない。

## 7.2 完了判定

- `kiro-review`: 独立レビュアーの厳密な判定 `APPROVED`。
- `kiro-verify-completion`: TASK 7.2 は VERIFIED。最終 stack JSON は expected 57 / unexpected 0 / flaky 0 / skipped 0。UI 7 ケースと両提供元 API を確認。
- 最終画像は final/390px-proton-touch-city.png と final/390px-adguard-touch-countries.png。親・独立レビュアー双方が目視確認。
- 7.3 と機能全体の GO は gateway の結果待ち。

## 7.3 と機能全体の完了判定

- `kiro-review`: 独立レビュアーが 7.3 を APPROVED。
- 全群 `npm run test:e2e`: 終了コード 0。lifecycle 5 件・stack 57 件・gateway 17 件、合格 79 件 / 不合格 0 件。unexpected/flaky はすべて 0。gateway の診断オプション 1 件は既定どおり skip。
- `kiro-validate-impl`: GO（location-city-selection の範囲）。独立した要件・設計・境界監査で未解消の具体的な不整合・blocked 項目なし。実アプリ起動・ブラウザ操作も成功。
- `kiro-verify-completion`: TASK 7.3 と FEATURE_GO は VERIFIED。タスクは小タスク 31/31 と大見出しを完了へ更新。承認フラグは変更していない。
- 最終 E2E の検証用コミットは検証サーバの一時リポジトリの `256dd2d`。本リポジトリへのコミットではない。変更対象 API/Web/E2E 全ファイルのローカルとサーバの SHA-256 一致を確認し、独立レビュアーも再照合。
- 成果物: `e2e/artifacts/hosted/2026-11-11-city-acceptance/final/results.tar.gz`、`full-run.log`、`source-sha256.txt`、`stack.json`、390px PNG 2 枚。JSON・集計・ログの整合を独立確認。
- 検証用 LXD は結果回収後に停止。既存の検証サーバ上のアプリは変更していない。

## main マージ可否

都市選択の機能としては GO。ただし現在のブランチをそのまま main へマージすることは推奨しない。

1. 修正は未コミット。選択ステージングを試みたが `.git/index.lock: Read-only file system` で失敗した。書き込み制限の回避は行っていないため、現在の HEAD をマージしても今回の修正は含まれない。
2. ブランチには多段接続の基盤実装が含まれ、作業ツリーには設定・cc-sdd 導入・多段接続仕様の変更もある。今回承認した範囲は都市選択であり、全変更を一括で main へ受け入れるレビューではない。Git へ書ける環境で取り込み範囲を整理・コミットし、その内容を確認する必要がある。
3. 確認時のリモート main は `0763e7a` で現在 HEAD の祖先。履歴の分岐はなく、現在 HEAD はその先に 51 コミットある。マージ・push は行っていない。

今回の依頼範囲は都市選択の完了とマージ可否再評価まで。多段接続の残タスクは実装していない。
