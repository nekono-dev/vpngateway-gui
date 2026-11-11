# 技術スタック

## アーキテクチャ

3つのアプリケーション（`api`・`proxy`・`web`）を、npm workspaces のモノレポとして構成する。配置は Docker Compose で行い、ホスト側の導入はシェルのインストーラが担う。

| 役割 | 実体 | ネットワーク |
|------|------|-------------|
| ゲートウェイ（VPN中継・DNS中継） | `proxy`（ベンダーのランナーを含む） | `network_mode: host` |
| APIサーバ（認証・設定・ベンダー操作） | `api` | 内部ネットワーク |
| Webサーバ（SPA配信・APIへのリバースプロキシ） | `web` | 公開ポート |

ブラウザは `web` の単一オリジンだけにアクセスする。`web` から `api` へ、`api` から `proxy` へは、いずれも HTTPS で接続し、証明書で検証する（検証を無効化しない）。

## 中核技術

- **言語**: TypeScript（`strict`）。ESM（`"type": "module"`）、モジュール解決は `NodeNext`。ローカルの import は `.js` 拡張子を付ける。
- **ランタイム**: Node.js 22（CIの指定に従う）
- **APIサーバ・Webサーバ**: Fastify 5
- **スキーマ**: TypeBox（`@sinclair/typebox`）。Fastify のルート定義で型付きスキーマとして使う。
- **フロントエンド**: React 18、Vite 5
- **APIクライアント**: `api` が出力する OpenAPI 定義から、`orval` で `web/src/generated/` に生成する。生成物は手で編集しない。
- **インストーラ**: POSIX `sh`。`shellcheck` で検査する。

## 主要ライブラリ

- `undici`: `api` からゲートウェイへの HTTP 接続
- `@fastify/swagger`・`@fastify/http-proxy`・`@fastify/static`: API定義の出力、リバースプロキシ、SPA の配信

## 開発の標準

### 型安全性
- TypeScript の `strict` を有効にする（`tsconfig.base.json`）。
- 静的検査は `typescript-eslint` の recommended を使う（`api` の `eslint.config.js`）。未使用の引数は `_` で始めて許可する。

### ベンダー中立性
- 本番のコード（コメントを含む）に、VPNベンダーの ID・表示名・CLI のバイナリ名を書かない。`scripts/check-vendor-neutrality.mjs` が、`vendors/*/profile.json` から禁止語を作って検査する。
- テスト（`*.test.*`）・生成物・`vendors/` の中身は、この検査の対象外である。

### テスト
- 単体テストは、対象ファイルと同じディレクトリに `*.test.ts` / `*.test.tsx` として置く（Vitest）。
- フロントエンド（`web/src`）の単体テストは jsdom で動かす。Webの配信サーバ側（`*.server.*`）のテストは node で動かす（`vitest.server.config.ts`）。
- 実ブラウザの E2E は `e2e/hosted/`（Playwright、`npm run test:e2e` は `sh e2e/hosted/run.sh` を呼ぶ）。通常の `npm test` には含めない。
- 受け入れテスト層（`tests/`・`test:acceptance`）は、現在のリポジトリにない。

### コメント
- 各ファイルの先頭に `// 責務: …` の1行を書き、そのファイルの役割を示す。
- コメントは日本語で書く。識別子は英語（関数・変数は camelCase、型は PascalCase）。

## 開発環境

### 必要なツール
- Node.js 22 以上、npm
- Docker（実際のゲートウェイ動作の確認に必要）
- Linux（ネットワーク操作は `nftables`・policy routing を使う）

### 主要コマンド

```bash
npm ci                        # 依存の導入
npm run generate:api-client   # OpenAPI からの API クライアント生成（web/src/generated/）
npm test                      # 単体テスト（proxy・api・web）・配信サーバのテスト・中立性検査・インストーラ検査
npm run test:e2e              # 実ブラウザの E2E（e2e/hosted/。事前に Playwright を導入）
npm run build                 # proxy → api → web の順にビルド
```

## 主要な技術的判断

- **ベンダーの宣言化**: 各ベンダーの操作（接続・切断・ログイン・状態取得）は、`profile.json` の宣言で表す。出力の解析も宣言（正規表現・プレースホルダ）で行う。
  - 根拠: ベンダーの追加を、本体の改修なしで行えるようにするため。
- **proxy は `network_mode: host`**: ゲートウェイは、ホストの nftables・ルーティング・TUN デバイスを直接操作する必要がある。
- **自己署名 CA によるホスト間 TLS**: インストーラが CA と証明書を生成・配布する。ブラウザ向けの証明書は自己署名である。
- **インストーラのトポロジー固定**: 一度決めた配置先（Web・API・ゲートウェイのホスト）は、`uninstall` を経ないと変更できない。

_標準とパターンを記述する。依存の網羅的な一覧にはしない。_

_updated_at: 2026-11-09（テストの配置・コメントと識別子の規約・テストの実行コマンドを、実装に合わせて修正）_
