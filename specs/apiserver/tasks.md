# 実装タスク

## プロジェクトセットアップ

- [ ] Fastify + TypeBox + `@fastify/swagger` によるプロジェクト初期化
- [ ] Dockerfile作成（APIコンテナ）
- [ ] lint / test 基盤の整備

## 管理者向け設定（VPNクライアント操作プロファイル）

- [ ] プロファイルJSONのTypeBoxスキーマ定義
- [ ] プロファイル読み込み処理（`:ro` マウント想定）の実装
- [ ] プレースホルダー検証ロジック（正規表現・`enumFrom`）の実装

## ユーザ向け設定

- [ ] ユーザ向け設定の永続化実装（設定ファイルまたはSQLite等の軽量DB）
- [ ] `GET /v1/connection/config` 実装
- [ ] `PUT /v1/connection/config` 実装
- [ ] `excludedDomains` 等の形式検証実装

## 接続制御API

- [ ] `GET /v1/connection` 実装
- [ ] `PUT /v1/connection` 実装（`connect`/`country` 検証・コマンド解決・UDS送信）
- [ ] `GET /v1/connection/countries` 実装

## ログイン代行API

- [ ] `POST /v1/session` 実装（`login` アクション解決・実行結果からログインURL抽出）

## 監査ログ

- [ ] コマンド実行要求・結果の構造化ログ記録実装
- [ ] `GET /v1/connection/log` 実装

## プロキシサーバとの内部通信

- [ ] `undici` の `Agent({ socketPath })` によるUDSクライアント実装
- [ ] 内部プロトコルのランタイムスキーマ検証実装（zod/TypeBox）
- [ ] UDS未応答・タイムアウト時のハンドリング実装

## エラーハンドリング

- [ ] 入力エラー（`400`）のハンドリング実装
- [ ] プロキシ接続失敗（`502`）のハンドリング実装
- [ ] プロキシ実行失敗（`422`、`exitCode`/`stderr`要約含む）のハンドリング実装
- [ ] タイムアウト（`504`）のハンドリング実装

## OpenAPI公開

- [ ] `/openapi.json` 公開設定
- [ ] orvalによるWeb側クライアント生成の疎通確認

## テスト

- [ ] プレースホルダー検証ロジックのユニットテスト
- [ ] APIエンドポイントの統合テスト（プロキシ疎通はモック化）

# 将来課題

- 認証・認可の追加（追加箇所: Fastifyの `preHandler` フックにセッション検証を挿入する想定）。
- レート制限（接続操作の連続実行を防ぐ）。
- 監査ログの長期保存・ローテーション方針。
