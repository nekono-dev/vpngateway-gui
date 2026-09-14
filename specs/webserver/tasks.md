# 実装タスク

## プロジェクトセットアップ

- [x] Vite + React（SPA）プロジェクト初期化
- [x] Fastify配信サーバセットアップ
- [x] Dockerfile作成（Webコンテナ）

## APIクライアント生成基盤

- [x] orval設定・`src/generated/api/` への生成確認
- [x] APIサーバのOpenAPI仕様変更時における再生成運用の整備（Dockerビルド内でapiビルド→openapi.json出力→orval生成を連結）

## リバースプロキシ

- [x] `@fastify/http-proxy` による `/api/*` → APIコンテナ（`http://api:3000`等）のリバースプロキシ実装

## 画面: 接続状態ダッシュボード

- [x] 接続状態（接続中/切断/エラー）・国表示実装（ベンダー表示は実装しない。設計方針上APIがベンダーを識別・選択可能にしないため、Web UIも1ベンダー運用を前提とし表示しない）
- [ ] 透過ゲートウェイ／明示的プロキシそれぞれの稼働状況表示実装（Phase 3/4でAPIが実際の稼働状況を返せるようになってから実装、`wbs/phase3.md`・`wbs/phase4.md`参照）
- [x] 設定ダイアログ起動ボタン実装（2026-09-14: 設定ダイアログ本体と合わせて実装。下記「画面: 設定ダイアログ」参照）
- [x] ログイン代行ボタン実装（`POST /v1/session`呼び出し・返却されたログインURL/メッセージの表示。Phase2で前倒し実装。ログイン完了後の状態反映は既存の接続状態ポーリングに委ね、待機処理は持たない。`wbs/phase2.md`参照）

## 画面: 接続操作

- [x] 接続国ドロップダウン実装（プロファイル定義の選択肢のみ、自由入力不可）。ベンダー選択UIは実装しない（1サーバー1ベンダーの設計方針、apiserver/requirements.md参照）
- [x] 接続/切断ボタン実装（二重送信防止・ローディング表示）

## 画面: 設定ダイアログ (Phase 2以降)

2026-09-14実装。`SettingsDialog.tsx`（ネイティブ`<dialog>`要素によるモーダル）を追加し、`GET`/`PUT /v1/connection/config`と接続した。ヘッドレスChromium（Playwright）でダイアログの開閉・トグル連動・保存後の永続化と再読込での反映を確認済み。

- [x] `killSwitch` トグルスイッチ実装
- [x] `excludedDomains` リスト編集UI実装（複数行入力→配列変換。`LineListEditor.tsx`として`explicitProxyAllowedCidrs`と共通化）
- [x] `defaultCountry` ドロップダウン実装（ダッシュボードの接続国選択と同じ`GET /v1/connection/countries`の一覧を再利用。1サーバー1ベンダー運用のため`GET /v1/vendors/{vendor}/countries`は実装しない）
- [x] `transparentGatewayEnabled` トグルスイッチ実装
- [x] `explicitProxyEnabled` トグルスイッチ実装
- [x] `explicitProxyAllowedCidrs` リスト編集UI実装（`explicitProxyEnabled` OFF時disabled連動）
- [x] ダイアログ内保存ボタンによる一括 `PUT` 実装

## 画面: 接続ログ (Phase 2以降)

- [ ] 監査ログ取得・履歴表示実装

## 状態管理・エラー表示

- [x] 状態のポーリング実装（デフォルト5秒間隔・画面表示中のみ）
- [ ] APIエラーレスポンスのトースト表示実装（詳細は折りたたみ表示）（Phase 1ではエラーメッセージのインライン表示のみ実装。トースト・詳細折りたたみUIはPhase 5で実装、`wbs/phase5.md`参照）

## テスト

- [ ] 画面単位のコンポーネントテスト
- [ ] Web⇄API（モックまたは実API）でのE2E動作確認

# 将来課題

- 認証UI（ログイン画面等）の追加。現時点では認証なし・LAN限定運用のため未実装。
- 多言語対応。
- WebSocket等によるリアルタイム状態通知への切替（ポーリング間隔・サーバ負荷が問題になった場合）。
