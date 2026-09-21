# 実装タスク

# Phase 1スコープについて

本ファイルのタスクはPhase 1（`wbs/phase1.md`）ではモックVPN CLI（proxyserver）を対象に実装する。`PUT /v1/connection/config`で受理する`killSwitch`等の設定値は、Phase 1では永続化のみ行い、プロキシ側への実反映（nftables操作等）はPhase 3以降（`wbs/phase3.md`）で行う。

## プロジェクトセットアップ

- [x] Fastify + TypeBox + `@fastify/swagger` によるプロジェクト初期化
- [x] Dockerfile作成（APIコンテナ）
- [x] lint / test 基盤の整備（2026-09-14: ESLint（`typescript-eslint`のrecommended構成）を導入し`npm run lint`を追加。テストは下記各項目参照）

## 管理者向け設定（VPNクライアント操作プロファイル）

- [x] プロファイルJSONのTypeBoxスキーマ定義
- [x] プロファイル読み込み処理（`:ro` マウント想定）の実装
- [x] プレースホルダー検証ロジック（正規表現・`enumFrom`）の実装

## ユーザ向け設定

- [x] ユーザ向け設定の永続化実装（設定ファイルまたはSQLite等の軽量DB）（Phase1は単一JSONファイル）
- [x] `GET /v1/connection/config` 実装
- [x] `PUT /v1/connection/config` 実装
- [x] `excludedDomains` 等の形式検証実装

## 接続制御API

- [x] `GET /v1/connection` 実装
- [x] `PUT /v1/connection` 実装（`connect`/`country` 検証・コマンド解決・UDS送信）
- [x] `GET /v1/connection/countries` 実装（**Phase 8で`GET /v1/connection/locations`へ置換**）

## 接続先（ロケーション）API (Phase 8)

`wbs/phase8.md`。設計は`design.md`「接続先（ロケーション）」。

- [x] プロファイル: `listLocations`アクション追加、`countries`・`enumFrom`方式の廃止、`%LOCATION%`（`source: "locations"`）の動的な許可値検証（`profile.schema.ts`・`placeholder-resolver.ts`・`api/config/vpn-profile.json`）
- [x] `list-locations`出力パーサー・接続先ID・接続時指定名（`(Virtual)`除去）（`locations/location-list-parser.ts`・`locations/location-id.ts`・`lib/slugify.ts`）
- [x] お気に入りストア・最後の接続先ストア（`locations/favorite-locations-store.ts`・`locations/last-location-store.ts`）
- [x] `GET /v1/connection/locations`（ping昇順・`favorite`・`lastConnected`付き）。`GET /v1/connection/countries`を廃止
- [x] `PUT`/`DELETE /v1/connection/locations/{locationId}/favorite`
- [x] `PUT /v1/connection`を`locationId`指定へ変更（接続時に`listLocations`を再実行して`id`を解決、成功時に最後の接続先・接続状態を保存）。`GET /v1/connection`に`locationId`を含める
- [x] 設定スキーマから`defaultCountry`を除去（既存設定ファイルの残存値を無視）
- [x] スキーマ検証エラーを400で返す（`app.ts`）
- [x] テスト（パーサー・ストア・各エンドポイント・プレースホルダー）

## ログイン代行API

- [x] `POST /v1/session` 実装（`login` アクション解決・実行結果からログインURL抽出）（Phase2で実装、`wbs/phase2.md`参照）

## 稼働状況取得API (Phase 5)

- [x] `proxy-client.ts`に`fetchProxyStatus()`追加（ExecResult同様、TypeBoxで応答形状を検証。2026-09-21）
- [x] `GET /v1/connection/gateway` 実装（TypeBoxスキーマ・OpenAPI公開。`routes/connection-gateway.ts`・`schemas/gateway.ts`。2026-09-21）
- [x] 上記の統合テスト（プロキシ疎通はモック化。200/502/504。`routes/connection-gateway.test.ts`・`proxy-client.test.ts`。2026-09-21）

## 監査ログ

- [x] コマンド実行要求・結果の構造化ログ記録実装
- [x] `GET /v1/connection/log` 実装

## プロキシサーバとの内部通信

- [x] UDSクライアント実装（`undici`の`Pool("http://localhost", {socketPath})`を使用。design.md記載の`Agent({socketPath})`と同等の目的を満たす）
- [x] 内部プロトコルのランタイムスキーマ検証実装（TypeBox）（2026-09-14: `proxy-client.ts`にExecResultのTypeBoxスキーマ検証を追加、期待と異なる形状の応答は例外を投げるよう変更。プロキシ側の受信リクエストは既に検証済み）
- [x] UDS未応答・タイムアウト時のハンドリング実装

## エラーハンドリング

- [x] 入力エラー（`400`）のハンドリング実装
- [x] プロキシ接続失敗（`502`）のハンドリング実装
- [x] プロキシ実行失敗（`422`、`exitCode`/`stderr`要約含む）のハンドリング実装
- [x] 接続先国の永続化（接続成功時に要求した国＋接続先の都市名を保存し、`GET /v1/connection`・`PUT`の応答へ`country`/`location`を付与、切断・接続先不一致で消去。`connection-state/connection-state-store.ts`。2026-09-21。Web UI再読み込みで接続国が消える不具合の修正）
- [x] 422の`stderr`が空の場合はstdoutを診断として返す（実CLI `adguardvpn-cli`はエラーをstdoutへ出力するため。Phase 5のE2Eで判明。`lib/failure-output.ts`。2026-09-21）
- [x] タイムアウト（`504`）のハンドリング実装（2026-09-14: 実機で`proxy`コンテナを`docker compose pause`により意図的に無応答化し、`GET /v1/connection`が`504 {"error":"proxy_timeout",...}`を返すことをE2Eで確認済み。`wbs/phase2.md`参照）

## OpenAPI公開

- [x] `/openapi.json` 公開設定
- [x] orvalによるWeb側クライアント生成の疎通確認

## テスト

- [x] プレースホルダー検証ロジックのユニットテスト（`profile/placeholder-resolver.test.ts`）
- [x] APIエンドポイントの統合テスト（プロキシ疎通はモック化）（`routes/session.test.ts`で`POST /v1/session`の200/422/502/504を検証。他エンドポイントは未着手）

# 将来課題

- 認証・認可の追加（追加箇所: Fastifyの `preHandler` フックにセッション検証を挿入する想定）。
- レート制限（接続操作の連続実行を防ぐ）。
- 監査ログの長期保存・ローテーション方針。
