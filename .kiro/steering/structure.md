# プロジェクト構造

## 組織の方針

アプリケーションは `api`・`proxy`・`web` に分け、内部は機能ドメイン単位に整理する。共通の小さな部品は `lib/` に置く。ベンダー固有の差分は `vendors/<ID>/` に閉じ込める。

## ディレクトリ

| パス | 役割 |
|---|---|
| `<app>/src/<domain>/` | API、proxy、Web の機能処理・型・テスト |
| `vendors/<ID>/` | `profile.json`、runner Dockerfile、Compose fragment と任意の起動資材 |
| `compose/` | root Compose の override fragment とホスト準備 CLI・処理 |
| `scripts/` | bundle 作成、配布物・文書の検査などの開発支援 |
| `e2e/` | hosted E2E、vendor-live E2E、共有クライアント |
| `.kiro/steering/` | プロダクト・技術・構造・ロードマップの共有方針 |

### アプリケーション

アプリ内は `<app>/src/<domain>/` に機能ごとに配置する。API の route は入出力変換を担い、処理は providers や domain module に委ねる。アプリ間の通信は API/HTTP または共有 UDS とし、別アプリのソースを直接 import しない。

### ベンダーと Compose

ベンダー追加時は `vendors/<ID>/` に宣言と runner 資材を置く。`docker-compose.yml` が Web/API/proxy、共通 network、socket と永続 volume の基礎を定義する。利用する runner は `vendors/<ID>/compose.yml` を root の後ろに merge する。TLS override は `compose/web-tls.yml` と `compose/api-tls.yml` に分け、必要なときだけ追加する。

### テストと配布

Vitest の単体テストは機能の近くに置く。E2E は `e2e/hosted/`、`e2e/vendor-live/`、`e2e/common/` に整理する。`scripts/` は配布 bundle と契約チェックを担う。利用者向けの導入・運用説明は README に記載する。

## 命名・編集規約

- ファイル名は `kebab-case`、テスト名は対象名に `.test` を付ける。
- 関数・変数は `camelCase`、型は `PascalCase`、環境変数は `SCREAMING_SNAKE_CASE`。
- ソースファイルの先頭に `// 責務: …` の日本語コメントを置く。
- `api/openapi.json`、`web/src/generated/`、`dist/` は生成物として扱い、直接編集しない。
- 本体コードにベンダー分岐を追加せず、宣言を読んで動かす。

_updated_at: 2026-11-19_
