# APIサーバ タスク一覧

## Phase 1: プロファイルとゲートウェイとの通信

- 対応: D-1, D-2, D-3
- [x] T-1.1: プロファイルのスキーマと、検証付きの読み込み、必須項目の欠落時の起動失敗を実装する。
- [x] T-1.2: プレースホルダーの検証と、引数配列への解決を実装する。
- [x] T-1.3: 相互TLSのクライアントと、エラーのHTTPステータス対応を実装する。
- [x] T-1.4: 起動処理と、設定の通知・再通知を実装する。
- [x] T-1.5: 操作と通信の受け入れテストを追加する。
- 検証: `npm run test -w api && npx vitest run --config tests/vitest.config.ts tests/apiserver/operations.test.ts tests/apiserver/settings.test.ts`

## Phase 2: ベンダー・実行可否・ログイン

- 対応: D-4, D-5, D-6
- [x] T-2.1: 有効なベンダーの保持と、切替の手順、ベンダー別の状態の分離を実装する。
- [x] T-2.2: 操作の実行可否の算出と、ログイン状態・プランの判定、失敗からの学習を実装する。
- [x] T-2.3: 二つのログイン方式と、秘密情報の伏字化を実装する。
- [x] T-2.4: ベンダー・実行可否・ログインの受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/apiserver/providers.test.ts tests/apiserver/capabilities.test.ts tests/apiserver/login.test.ts`

## Phase 3: 接続先・接続・設定

- 対応: D-7, D-8, D-9
- [x] T-3.1: 接続先の表の解析、IDと指定名の導出、お気に入りと最後の接続先の永続化を実装する。
- [x] T-3.2: 接続・切断・接続状態の保存と、起動時の復元を実装する。
- [x] T-3.3: ユーザ向け設定の検証・永続化・反映と、稼働状況の中継を実装する。
- [x] T-3.4: 接続と設定の受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/apiserver/operations.test.ts tests/apiserver/settings.test.ts`

## Phase 4: 利用者の認証とプランの情報

- 対応: D-10, D-11
- [x] T-4.1: 利用者アカウントの作成・変更、ログイン・ログアウト、認可フック、回数制限を実装する。
- [x] T-4.2: プランの補足情報と、接続先を選べないプランの参考一覧を実装する。
- [x] T-4.3: 認証とプラン情報の受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/apiserver/operator.test.ts tests/apiserver/capabilities.test.ts`

## Phase 5: 動作検証と再起動の依頼

- 対応: D-12, D-13
- [x] T-5.1: 検証項目の導出と、1件ずつの実行、端末の項目の判定を実装する。
- [x] T-5.2: ゲートウェイ機の再起動の依頼を実装する。
- [x] T-5.3: 動作検証と再起動の受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/apiserver/verification.test.ts`
