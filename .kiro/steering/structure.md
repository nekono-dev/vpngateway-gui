# プロジェクト構造

## 組織の方針

アプリケーションは `api`・`proxy`・`web` の3つに分け、それぞれの内部は **ドメイン（機能の単位）ごとのディレクトリ** で整理する。共通の部品は `lib/` に置く。

ベンダー固有の差分は、アプリケーションのコードではなく `vendors/<ID>/` に閉じ込める。

## ディレクトリのパターン

### アプリケーションの内部（`api/src/`・`proxy/src/`・`web/src/`）
**配置**: `<app>/src/<ドメイン>/`
**役割**: ドメインごとに、そのドメインの処理・型・テストをまとめる。
**例**: `api/src/routes/`（HTTPルート）、`api/src/providers/`（ベンダーの切り替え）、`proxy/src/network/`（nftables・ルーティング）、`proxy/src/dns-relay/`（DNS中継）

`lib/` には、ドメインに依存しない小さな共通部品だけを置く（例: `ipv4-cidr.ts`・`redact.ts`）。

### ルートの定義（`api/src/routes/`）
**配置**: `<機能>.ts`（`connection-*.ts`・`operator*.ts` のように、関連する機能はハイフンで前置きをそろえる）
**役割**: `registerXxxRoute` という名前の Fastify プラグインを1つ export する。TypeBox でリクエストと応答の型を定義する。

### ベンダーの追加（`vendors/<ID>/`）
**配置**: `vendors/<ID>/` に、`profile.json`・`Dockerfile`・`compose.yml` を置く（任意で `entrypoint.sh`・`install-host.sh`・`samples.json`）。
**役割**: そのベンダーのCLIの操作と出力の宣言を置く。本体のコードには書かない。
**例**: `vendors/adguardvpn/profile.json` の `actions.connect.argv` に、接続コマンドの引数と場所のプレースホルダを宣言する。

### テスト
**配置**: 単体テストは、対象と同じディレクトリに `<名前>.test.ts`。受け入れテストは `tests/<アプリ名>/`、E2E は `tests/e2e/` と `e2e/`。
**役割**: 単体テストは、そのファイルの振る舞いを確かめる。受け入れテストは、利用者の観点の条件を確かめる。

### ビルド・配布の資材
**配置**: `compose/`（コンテナ定義の断片）、`installer/`（シェルのインストーラ）、`scripts/`（検査スクリプト）
**役割**: 配置・導入の処理を、アプリケーションのコードから切り離す。

## 命名規約

- **ファイル**: `kebab-case`（例: `gateway-controller.ts`、`dns-relay-controller.ts`）
- **テスト**: 対象のファイル名に `.test` を付ける（`bypass-set.test.ts`）
- **関数・変数**: `camelCase`。プラグインは `registerXxx`、データ読み込みは `readXxx`、判定は `isXxx` / `hasXxx` のように動詞を前置きする
- **型・スキーマ**: 型は `PascalCase`。TypeBox のスキーマ変数は `XxxSchema`（例: `AvailableLocationsResponseSchema`）
- **環境変数**: `SCREAMING_SNAKE_CASE`（例: `PROVIDER_CACHE_DIR`）

## import の整理

```typescript
// 外部パッケージ（node: 組み込みを先頭に置く）
import { join } from "node:path";
import Fastify from "fastify";

// 同一アプリ内の相対 import（必ず .js 拡張子を付ける）
import { getActiveProvider } from "../providers/active-provider-store.js";
import { loadApiCaCertificate } from "./tls-options.js";
```

- 絶対パス（`@/` などのエイリアス）は使わず、相対 import で書く。
- アプリ間の直接 import は行わない。アプリどうしは HTTP（HTTPS）で通信する。

## コードの構成の原則

- **責務の分離**: ルートは入出力の変換だけを担い、処理は `providers/`・`network/` などのドメインへ委ねる。
- **生成物は編集しない**: `web/src/generated/`・`api/openapi.json`・`dist/` は、生成コマンドで作る。直接編集しない。
- **ベンダーの分岐を増やさない**: 本体のコードにベンダーごとの `if` を書かず、`profile` の宣言を読んで動かす。
- **外部コマンドの実行**: 外部コマンドは `child_process` を直接呼ぶ箇所と、`proxy/src/exec/command-runner.ts` を経由する箇所がある。ネットワーク操作（`nft`・`ip`）は `proxy/src/network/` 配下のモジュールが直接呼んでいる。新しく外部コマンドを呼ぶときは、既存の `command-runner` の利用を検討する。

_新しいファイルが既存のパターンに従うなら、この文書を更新する必要はない。_
