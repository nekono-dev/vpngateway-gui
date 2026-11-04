# Brief: dark-mode

## Problem
Web UI（管理画面）を暗い場所や夜間に使う利用者が、白い画面を眩しく感じる。OS をダークに設定していても、画面はライトのままになる。

## Current State
- 色は `web/src/styles.css`（約1600行）の `:root` に定義された CSS 変数で、ライト配色だけが定義されている。`prefers-color-scheme` や テーマ用の仕組みはない。
- CSS 内の色指定は約44か所。TSX 側に色のインライン指定は見当たらない。
- `web/index.html` の `theme-color` は `#0969da` の固定値。
- テーマの状態を扱う Context はない（`web/src/contexts/` には `AuthContext` のみ）。
- ログイン前の画面（`SetupPage`・`LoginPage`）は `Root.tsx` から表示される。
- 管理者は単一アカウント（`api/src/auth/operator-account-store.ts`）。運用設定は `api/src/settings/settings-store.ts` が単一 JSON ファイル（`SETTINGS_FILE`）へ保存しており、保存先の作法はこれに揃えられる。

## Desired Outcome
- 既定では OS の配色設定に従う（OS がダークならダーク、ライトならライト）。
- 画面内のボタンで「OS 規定 → ライト → ダーク」の順に切り替えられる。
- 選択は **サーバ（api）に保存** され、どのブラウザから開いても同じ表示になる。
- 全画面（ログイン前の初期設定・ログイン画面を含む）で、保存されたテーマが反映される。
- テーマを取得するまでは画面を描画せず、白いちらつきを出さない（取得完了までは空白を表示する）。

## Approach
採用: **A. CSS 変数 + `data-theme` 属性**（色の定義の方式）。保存先は **api のサーバ側**。
- `:root` をライト、`[data-theme="dark"]` で上書きする。既定（OS 規定）は `@media (prefers-color-scheme: dark)` で扱う。
- **api に UI 表示用の設定を追加する**。ゲートウェイの運用設定（`UserSettings`）とは分け、別ファイル（`$STATE_DIR` 配下）に保存する。理由: `UserSettings` は保存時に proxy への反映と検証を伴うため、表示だけの値を混ぜると影響範囲が広がる。
  - `GET`: 未ログインでも呼べる。返すのはテーマの値だけ（機微情報を含まない）。未設定なら「OS 規定」を返す。
  - `PUT`: 管理者セッションが必要。値は `system` / `light` / `dark` の3種に限る。
- `web` 側は、起動時に `GET` で値を取り、取得が終わってから画面を描画する（`Root.tsx` の読み込み中と同じ扱い）。取得した値を `<html>` の `data-theme` に設定する。
- 切り替えボタンは `PUT` で保存し、成功後に `<html>` の属性を変える。保存に失敗したら表示を戻し、エラーを出す。
- `theme-color` は選択に合わせて `<meta name="theme-color">` を切り替える。
- 採用理由: 色の定義を CSS 変数に一本化でき、既存の約44か所を変数経由に置き換えるだけで済む。外部ライブラリを増やさない。
- 却下した案:
  - ブラウザ（localStorage）だけに保存する案: 利用者の要望（サーバ側に載せる）に反するため。
  - React の state だけで切り替える案: 初回描画が遅れ、白く見えるため。
  - テーマごとに CSS を分ける案: 色定義が二重になるため。

## Scope
- **In**:
  - `api`: UI 表示用の設定の保存（ファイル・スキーマ・`GET`/`PUT` のルート）と、その単体テスト・受け入れテスト。
  - `api`: OpenAPI 定義の更新。`web` は `orval` で `web/src/generated/` を再生成する。
  - `web/src/styles.css`: 色を CSS 変数経由に整理し、ダーク用の値を定義する。
  - `web`: テーマの Context（取得・保存・適用）、切り替えボタン（全画面で見えるヘッダー周辺）、取得までの描画の待ち合わせ、`theme-color` の追従。
  - `web`: 単体テスト（Vitest / jsdom）。
- **Out**:
  - proxy・インストーラの変更。
  - ゲートウェイの運用設定（`UserSettings`）へのテーマの追加。
  - ブラウザ側（localStorage）での保存やキャッシュ。
  - 配色の全面的なデザイン刷新（既存の色の意味を保ち、暗い背景に合わせて調整するだけ）。
  - 利用者向け README の変更（必要になれば別途判断する）。

## Boundary Candidates
- 保存と API（ファイル・スキーマ・ルート）: `api/src/` 配下の新規モジュール
- テーマの定義（CSS 変数・配色）: `web/src/styles.css`
- テーマの状態（取得・保存・適用）: `web/src/contexts/` 配下の新規 Context
- 切り替えボタンの UI: 既存のヘッダー周辺のコンポーネント

## Out of Boundary
- 認証の仕組み（`AuthContext`・セッション）の挙動の変更。未ログイン向け `GET` は認証の仕組みを流用せず、公開の読み取りとして扱う。
- ベンダー（`vendors/`）や `profile.json` に関わる部分。

## Existing Spec Touchpoints
- **Extends**: なし（既存の spec `e2e-tests`・`cicd`・`vendor-live-e2e` は UI のテーマを扱っていない）。
- **Adjacent**:
  - `e2e-tests`: 実ブラウザの E2E（`tests/e2e/`、Playwright）が画面を操作している場合、取得待ちとテーマの追加で影響を受けるおそれがある。実装時に確認する。
  - `cicd`: E2E を CI で走らせる場合、テーマを変えた画面の検証を含めるかを後で判断する。

## Upstream / Downstream
- **Upstream**: 既存の api の認証（管理者セッション）。`PUT` の保護に使う。
- **Downstream**: なし（将来の機能は現時点で想定しない）。

## Constraints
- 技術: React 18・Vite 5・TypeScript（`strict`）。api は Fastify 5 と TypeBox。外部の CSS フレームワークや色ライブラリは追加しない。
- 規約: 新規ファイルの先頭に `// 責務: …` の1行を書く。コメントと識別子は日本語。テストは対象と同じディレクトリに `*.test.ts` / `*.test.tsx` として置く。
- 生成物: `web/src/generated/` は手で編集しない。API 変更後は `npm run generate:api-client` で再生成する。
- 互換性: モダンブラウザ（CSS 変数と `prefers-color-scheme` に対応するもの）を対象とする。
- 検証: 実機の見た目は、ライト・ダーク・OS 規定の3通りで確認する（Playwright のスクリーンショットを含めてよい）。
