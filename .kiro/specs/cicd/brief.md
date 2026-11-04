# Brief: cicd

## Problem
現在の CI は、単体テストとインストーラ検査（`installer-check.yml`）と、install.sh の生成（`release-installer.yml`）のみ。
PR に対する自動検査が無く、E2E も CI に組み込まれていない。変更の回帰は手元の実行に頼っている。

## Current State
- `installer-check.yml`（再利用ワークフロー）: シェルの構文・shellcheck、`npm ci`、`npm run generate:api-client`、`npm test`
  （proxy・api・web の単体テスト、`check:neutrality`、`test:install`）を実行する。`PLAYWRIGHT_VERSION: 1.63.0` を env に定義しているが、どのステップでも使われていない。
- `release-installer.yml`: `push`（全ブランチ `**`）、タグ（`v*`）、`workflow_dispatch` で起動し、`installer-check` を呼んだ後、install.sh を生成して artifact へ保存する。タグでは GitHub Release へ添付する。
- `pull_request` のトリガーは無い。

## Desired Outcome
- push と PR で、単体テスト・検査・E2E が自動で走り、結果が PR に明確に出る。
- E2E が失敗したときに、Playwright のレポートが artifact として残る。
- 既存の `release-installer.yml` の挙動（install.sh の生成、artifact、タグの Release 添付）を壊さない。

## Approach
- 既存の `installer-check.yml` を検査の土台として残し、E2E のジョブを追加する。E2E ジョブは `e2e-tests` が定めた実行エントリポイントを呼ぶだけにする。
- 権限は最小にする（`permissions` を明示。不要な `packages: read` は、必要性を確認して外す）。
- 同一ブランチの古い実行を取り消す（`concurrency`）。
- 外部 fork の PR は secrets を受け取らない形にする（`pull_request` を使い、`pull_request_target` は使わない）。

## Scope
- **In**: PR と push でのテスト・検査・E2E のワークフロー。キャッシュ、並列化、権限、同時実行制御、失敗時の artifact。既存ワークフローとの統合。
- **Out**: 検証サーバへの自動デプロイ（ユーザーの選択により対象外）。GHCR 等へのイメージ公開。リリース手順（タグ・Release）の変更。self-hosted runner の利用。
  保護ブランチの必須チェックの設定（リポジトリの設定画面での作業のため、手順だけを示す）。

## Boundary Candidates
- 検査ジョブ（shellcheck・単体テスト・中立性・インストーラ検査）
- E2E ジョブ（`e2e-tests` の実行エントリポイントの呼び出し）
- 報告と artifact（失敗時のレポート、install.sh の成果物）

## Out of Boundary
- E2E のシナリオの内容と基盤（`e2e-tests`）
- インストーラの動作そのもの、install.sh の生成ロジック（`installer/`）

## Upstream / Downstream
- **Upstream**: `e2e-tests`（E2E の実行エントリポイントと、その終了コード・成果物の契約）。既存の `package.json` のスクリプト（`test`・`check:neutrality`・`test:install`）。
- **Downstream**: 保護ブランチの必須チェック（手動の設定。spec の範囲外）。

## Existing Spec Touchpoints
- **Extends**: なし（既存の spec は無い）
- **Adjacent**: `.github/workflows/installer-check.yml`、`.github/workflows/release-installer.yml`（既存の挙動を変えない）

## Constraints
- リポジトリは PUBLIC。外部 fork の PR に secrets と書き込み権限を渡さない。
- 自前ホストの runner は使わない（hosted runner のみ）。
- Actions 上でしか完全には検証できない。ワークフローの変更は、ブランチへの push と実行結果で確認する（push は許可済み）。
- 既存の action のバージョン（`actions/checkout@v7`、`actions/setup-node@v7`、`actions/upload-artifact@v7`、`actions/download-artifact@v8`）と、既存のワークフローの記述規約（日本語の名前とコメント）に合わせる。
- ユーザーの指示により、コード中コメントとドキュメントは仕様の根拠にしない。判断は実装から行う。
