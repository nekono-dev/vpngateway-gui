# 技術スタック

## アーキテクチャ

`api`・`proxy`・`web` の3アプリを npm workspaces のモノレポとして構成し、root Compose と選択した runner fragment で単一ノードに配置する。

| 役割 | 実体 | ネットワーク |
|---|---|---|
| VPN・DNS 中継 | `proxy` と選択した runner | host network、ネットワーク操作に必要な権限 |
| API | 認証・設定・runner 操作 | Compose 内部 network、host port 非公開 |
| Web | SPA と API reverse proxy | 利用者向け host port |

ブラウザから Web への HTTPS は `WEB_HTTPS_ENABLED` で任意に有効化し、既定は `false`。Web から API は同一ノード内の HTTP。API から Gateway は共有 UDS 上の HTTP を既定とし、`GATEWAY_TLS_ENABLED=true` のときだけ UDS 上の厳格な mTLS を使う。TLS 有効時の証明書は運用者が用意し、用途別 Compose fragment が read-only mount する。TLS 失敗を平文へ降格しない。

ホスト準備は `compose/host-preparation.sh` の `check|apply|status|remove` に限定する。Debian 12+/Ubuntu 22.04+、rootful のローカル Docker、nftables、systemd を前提とする。起動時 boot guard の実適用・確認に失敗する環境はサポート対象外。guard は透過ゲートウェイの転送を保護し、明示的プロキシだけを利用する場合の停止時遮断は保証しない。

導入・更新・停止・削除は Compose lifecycle で行い、すべての Compose command に `-p vpngwgui` を付ける。通常の `down` は named volume を保持し、`down -v` は明示的なデータ削除操作。ホスト設定の `remove` は Compose を `down` した後に行う。常設 installer や update command は提供しない。旧方式からの移行・データ引き継ぎは対象外。

## 中核技術

- 言語: TypeScript strict、ESM、Node.js 22
- API/Web server: Fastify 5、スキーマ: TypeBox
- フロントエンド: React 18、Vite 5
- API client: OpenAPI から `web/src/generated/` に生成し、生成物を直接編集しない
- 開発・配布資材: POSIX `sh`、Docker Compose、nftables、systemd
- ゲートウェイ制御: API と proxy の共有 UDS。runner 用制御 socket volume は Gateway socket volume と分離

## 開発の標準

### 型・構成

- TypeScript の `strict` を使う。ローカル import は相対パスと `.js` 拡張子を使う。
- ルートは入出力変換に限り、処理を機能ドメインへ委ねる。
- ベンダーの挙動は `profile.json` と vendor fragment に置き、本体のコードへベンダー固有分岐を追加しない。
- `api/openapi.json` と `web/src/generated/` は生成コマンドで更新する。

### ベンダー中立性

本番コードとそのコメントに、ベンダー固有の ID・表示名・CLI 名を書かない。`scripts/check-vendor-neutrality.mjs` が profile から禁止語を作って検査する。テスト・生成物・`vendors/` は検査対象外。

### テストとコメント

- Vitest の単体テストは対象ファイルの近くに置き、Web server test は node 環境で実行する。
- 実ブラウザ E2E は `e2e/hosted/`、実 VPN の検証は `e2e/vendor-live/` に分ける。
- 各ソースファイルの先頭に `// 責務: …` の1行を書く。コメントは日本語、識別子は英語。

## 開発環境とコマンド

必要なものは Node.js 22 以上、npm。Compose や nftables を使ったゲートウェイ検証には対応 Linux 環境が必要。

```sh
npm ci
npm test
npm run test:e2e-unit
npm run build
npm run generate:api-client
```

_updated_at: 2026-11-19_
