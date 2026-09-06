# 実装タスク

# Phase 1スコープについて

本ファイルのタスクはPhase 1（`wbs/phase1.md`）ではモックVPN CLI（proxyserver）を対象に実装する。`PUT /v1/connection/config`で受理する`killSwitch`等の設定値は、Phase 1では永続化のみ行い、プロキシ側への実反映（nftables操作等）はPhase 3以降（`wbs/phase3.md`）で行う。

## プロジェクトセットアップ

- [x] Fastify + TypeBox + `@fastify/swagger` によるプロジェクト初期化
- [x] Dockerfile作成（APIコンテナ）
- [ ] lint / test 基盤の整備（vitestは導入済みだがテスト自体は未作成、ESLint未導入）

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
- [x] `GET /v1/connection/countries` 実装

## ログイン代行API

- [ ] `POST /v1/session` 実装（`login` アクション解決・実行結果からログインURL抽出）（Phase2で実装、`wbs/phase2.md`参照）

## 監査ログ

- [x] コマンド実行要求・結果の構造化ログ記録実装
- [x] `GET /v1/connection/log` 実装

## プロキシサーバとの内部通信

- [x] UDSクライアント実装（`undici`の`Pool("http://localhost", {socketPath})`を使用。design.md記載の`Agent({socketPath})`と同等の目的を満たす）
- [ ] 内部プロトコルのランタイムスキーマ検証実装（zod/TypeBox）（プロキシ側の受信リクエストは検証済み。APIサーバ側でプロキシからのレスポンス形状を実行時検証する処理は未実装、型アサーションのみ）
- [x] UDS未応答・タイムアウト時のハンドリング実装

## エラーハンドリング

- [x] 入力エラー（`400`）のハンドリング実装
- [x] プロキシ接続失敗（`502`）のハンドリング実装
- [x] プロキシ実行失敗（`422`、`exitCode`/`stderr`要約含む）のハンドリング実装
- [x] タイムアウト（`504`）のハンドリング実装（コードパスは実装済み。実際のタイムアウト発生によるE2E確認は未実施）

## OpenAPI公開

- [x] `/openapi.json` 公開設定
- [x] orvalによるWeb側クライアント生成の疎通確認

## テスト

- [ ] プレースホルダー検証ロジックのユニットテスト
- [ ] APIエンドポイントの統合テスト（プロキシ疎通はモック化）

# 将来課題

- 認証・認可の追加（追加箇所: Fastifyの `preHandler` フックにセッション検証を挿入する想定）。
- レート制限（接続操作の連続実行を防ぐ）。
- 監査ログの長期保存・ローテーション方針。
