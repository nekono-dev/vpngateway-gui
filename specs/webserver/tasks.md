# Webサーバ タスク一覧

## Phase 1: 配信・認証の画面・通知

- 対応: D-1, D-2, D-13
- [x] T-1.1: 画面の配信とAPIサーバへの転送（証明書の検証つき）を実装する。
- [x] T-1.2: 初期設定画面・ログイン画面・認証状態の保持・認証切れ時の復帰を実装する。
- [x] T-1.3: 通知の表示と、APIのエラーの要約への変換を実装する。
- [x] T-1.4: 配信と認証の受け入れテストと、認証の画面の実ブラウザのテストを追加する。
- 検証: `npm run test -w web && npx vitest run --config tests/vitest.config.ts tests/webserver/server.test.ts tests/webserver/auth.test.tsx`
- E2E: `tests/e2e/auth.spec.ts` 未認証でページを開く → 初期設定画面、続いてログイン画面に切り替わり、認証後にダッシュボードが表示される

## Phase 2: ダッシュボード

- 対応: D-3, D-4, D-5, D-6, D-7, D-8
- [x] T-2.1: 状態の定期取得と、取得失敗の部分ごとの分離を実装する。
- [x] T-2.2: 実行可否に従う部品の無効化と理由文の表示を実装する。
- [x] T-2.3: ベンダーの選択と、ベンダーへのログインの導線を実装する。
- [x] T-2.4: 接続先リストと、接続・接続先の変更・切断の操作を実装する。
- [x] T-2.5: 参考の国・都市の一覧を実装する。
- [x] T-2.6: ダッシュボードの受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/webserver/dashboard.test.tsx tests/webserver/login.test.tsx tests/webserver/locations.test.tsx`
- E2E: `tests/e2e/dashboard.spec.ts` 接続先を選んで接続を押す → 接続中の表示に変わり、ベンダーの切替では確認を経て接続先の一覧が入れ替わる

## Phase 3: 設定ダイアログ・動作検証・メンテナンス

- 対応: D-9, D-10, D-11, D-12
- [x] T-3.1: タブ付きの設定ダイアログと、一括の保存、入力不備の警告を実装する。
- [x] T-3.2: 行リストエディタと、その純粋関数を実装する。
- [x] T-3.3: 動作検証の表示、ブラウザ側の観測、進行の取得を実装する。
- [x] T-3.4: アカウント情報の変更とゲートウェイ再起動のダイアログを実装する。
- [x] T-3.5: 設定・検証・メンテナンスの受け入れテストと、実ブラウザのテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/webserver/settings.test.tsx tests/webserver/verification.test.tsx`
- E2E: `tests/e2e/settings.spec.ts` 設定ダイアログを開いてタブを切り替え、迂回ドメインの行を追加する → 保存ボタンの押下で設定が一括で送信され、動作検証の実行で各項目の結果が表示される

## Phase 4: レイアウトとホーム画面への追加

- 対応: D-14
- [x] T-4.1: 入力欄・ヘッダ・縦幅・余白・横スクロールの列・ボタンの折り返しのスタイルを実装する。
- [x] T-4.2: マニフェスト・アイコン・Service Workerと、その登録を実装する。
- [x] T-4.3: レイアウトと資材の受け入れテストと、スマートフォン幅の実ブラウザのテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/webserver/layout.test.ts`
- E2E: `tests/e2e/dashboard.spec.ts` スマートフォン幅でダッシュボードを開く → ヘッダのタイトルが非表示になり、ページが横にスクロールしない
