# Research & Design Decisions

---
**Purpose**: ダークモードの設計に使った調査と判断の根拠を残す。`design.md` を読むのに必要な結論は `design.md` にも書いてある。
---

## Summary
- **Feature**: `dark-mode`
- **Discovery Scope**: Extension（既存の api と web を拡張する。新規の外部依存はない）
- **Key Findings**:
  - 色は `web/src/styles.css` の `:root` に定義された CSS 変数（ライト配色のみ）と、ルール内に直接書かれた色（`#fff`・`#f6f8fa` など）で構成される。直接書かれた色は CSS 内にだけ存在し、TSX にはない。
  - 管理画面の API は、`/v1/*` の全ルートに `requireOperatorSession` を適用する。未認証で呼べるルートは `UNAUTHENTICATED_ROUTES` に列挙する方式で、公開の読み取りはここへ登録して実現する。
  - 運用設定（`UserSettings`）の保存は `SETTINGS_FILE` の単一 JSON ファイルで、保存時にプロキシへの反映が走る。表示用の値はこの仕組みに混ぜない。
  - web の `sw.js` は `/api/*` をキャッシュしない。静的アセットはキャッシュ優先で、テーマ用の CSS も同じ扱いになる。

## Research Log

### 既存の API 認可の仕組み
- **Context**: 未ログインでテーマの値を読めるルートを、既存の認可にどう組み込むかを確認する必要があった。
- **Sources Consulted**: `api/src/auth/require-operator-session.ts`、`api/src/app.ts`、`api/src/routes/operator.ts`
- **Findings**:
  - `requireOperatorSession` は `app.addHook("preHandler", …)` で全ルートに掛かる。`UNAUTHENTICATED_ROUTES`（`"METHOD /path"` の集合）に載るルートだけ素通しする。
  - 未認証の拒否は `UnauthenticatedError` を投げ、エラーハンドラで 401 の `{ error: "unauthenticated" }` に変換される。
  - 認可の例外に入れるのは `GET` のみでよい。`PUT` は既定どおり保護される。
- **Implications**: `GET /v1/ui-preferences` を `UNAUTHENTICATED_ROUTES` に加え、`PUT` は既定のまま保護する（要件 7.1・7.2、3.2）。

### 保存先の作法
- **Context**: テーマの値を api のどこに保存するか。
- **Sources Consulted**: `api/src/settings/settings-store.ts`、`api/src/auth/operator-account-store.ts`、`api/src/providers/provider-state-paths.ts`
- **Findings**:
  - 状態ファイルの置き場は `stateDir()`（環境変数 `STATE_DIR`、既定 `/var/lib/vpngwgui`）。アカウントはこの配下の `operator-account.json`。
  - 運用設定は `SETTINGS_FILE`（既定 `/var/lib/vpngwgui/settings.json`）。
  - 両者とも単一 JSON の read-modify-write で、同時書き込みの排他はしていない。低頻度更新・単一管理者のため。
- **Implications**: テーマは `$STATE_DIR/ui-preferences.json` に保存する。書き込みの作法は既存に揃え、排他は行わない。

### 運用設定と表示設定を分ける理由
- **Context**: `UserSettings` に `theme` を足す案もあった。
- **Findings**:
  - `updateSettings` は保存後に `notifySettings` でプロキシへ全体を送る。表示だけの値でも、ゲートウェイ設定と同じ経路に乗る。
  - `UserSettingsPatchSchema` は全項目が任意で、表示値の不正をゲートウェイ設定の検証と同じ入口で扱うことになる。
- **Implications**: 表示設定は独立したストア・スキーマ・ルートにする（`design.md` の Decision 1）。

### Playwright による画面確認の再利用
- **Context**: 利用者の指示により、E2E による画面確認は設計で決める。
- **Sources Consulted**: ルート `package.json`（`@playwright/test` 1.63.0 を devDependency に固定）、`e2e/hosted/playwright.config.ts`、`e2e/hosted/run.sh`、`web/vite.config.ts`
- **Findings**:
  - 既存の `npm run test:e2e` は `e2e/hosted/run.sh`（compose スタックを起動する CI 向けの実行）。通常の開発では重く、テーマの確認には過剰。
  - `web/` 単体で `vite preview` を起動し、API を Playwright の `page.route` でモックすれば、compose スタックなしで画面を確認できる。
  - 既存のスクリプト名（`test:e2e`）は `e2e-tests` の所有。この spec では変更しない。
- **Implications**: 画面確認は `web/tests/screens/` に置き、`web` ワークスペースのスクリプト `test:screens` から実行する（`design.md` の Decision 5）。

### matchMedia による OS 配色の追従
- **Context**: OS の配色設定を CSS の `@media (prefers-color-scheme)` で扱うか、JS で解決するか。
- **Findings**:
  - CSS の `@media` で扱うと、ダーク用の変数を二重に書く必要がある（`:root:not([data-theme="light"])` と `:root[data-theme="dark"]`）。
  - JS で `matchMedia("(prefers-color-scheme: dark)")` を読み、解決後の `light` / `dark` を `data-theme` へ書けば、CSS は1組の変数で済む。変化の購読（`change` イベント）で再読み込みなしに追従できる（要件 1.4）。
  - `theme-color` も解決後の値で決まるため、JS で扱う方が一貫する。
- **Implications**: 解決は JS で行う（`design.md` の Decision 3）。

### 取得完了まで描画しない方式
- **Context**: 要件 4.1 の「取得まで空白」を、どの層で実現するか。
- **Findings**:
  - 既存の `Root.tsx` は `auth.status === "loading"` のとき `null` を返しており、同じ作法に揃えられる。
  - `ThemeProvider` が取得完了まで子要素を描画しなければ、`AuthProvider` と `Root` の描画もその後になる。
  - 取得が失敗した場合は、要件 3.4 により「OS 規定」で描画を続ける。
- **Implications**: `main.tsx` の Provider 順は `ToastProvider` > `ThemeProvider` > `AuthProvider` > `Root`。`ThemeProvider` は取得中 `null` を返す。

### Service Worker との関係
- **Sources Consulted**: `web/public/sw.js`
- **Findings**:
  - `/api/*` は SW が扱わない（キャッシュされない）。
  - 静的アセットは「キャッシュ優先・裏で更新」。新しい `styles.css` は、次回読み込みで古い版が出る可能性がある（既存の挙動）。
  - ナビゲーションは「ネット優先」で、オフライン時のみ `/` のキャッシュを返す。
- **Implications**: テーマ機能で SW は変更しない。古い CSS の一時表示は既存の挙動として `design.md` のリスクに記録する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| CSS 変数 + data-theme（採用） | 色を変数に一本化し、属性で切り替える | 既存の色を変数に置き換えるだけ。外部依存なし | 直接書かれた色の置き換え漏れ | brief の方式 A |
| React state のみ | state で class や style を切り替える | 変更が少ない | 初回描画前に決められず、白く見える | 却下（brief と同じ） |
| テーマごとの CSS ファイル | ライトとダークで別ファイルを読む | 分離が明確 | 色の定義が二重 | 却下 |

## Design Decisions

### Decision: 表示設定を運用設定（`UserSettings`）から分ける
- **Context**: 要件 2.1 は、テーマを api に保存することを求める。保存先の候補は `UserSettings` への追加と、独立したストア。
- **Alternatives Considered**:
  1. `UserSettings` に `theme` を追加する
  2. 独立したストアと `GET/PUT /v1/ui-preferences` を作る
- **Selected Approach**: 2 を採用する。
- **Rationale**: `UserSettings` は保存のたびにプロキシへ全体を通知する。表示値の保存でもゲートウェイへの通知が走り、表示設定の変更が運用設定の検証と結び付く。独立させれば、表示の変更がゲートウェイの動作に影響しない。
- **Trade-offs**: 保存先ファイルと API ルートが1組増える。
- **Follow-up**: 将来、表示設定が増えたら、このストアに項目を足す。

### Decision: 公開の読み取りは GET だけにする
- **Context**: 要件 3.1 と 3.2 は、未ログインでテーマを読めることを求める。認可の例外を増やす範囲を最小にしたい。
- **Selected Approach**: `UNAUTHENTICATED_ROUTES` に `GET /v1/ui-preferences` を加える。`PUT` は保護したままにする。
- **Rationale**: 公開するのはテーマの値だけで、機微情報を含まない。`PUT` は要件 7 に従い、管理者のセッションが必要。
- **Trade-offs**: 認可の例外が1つ増える。レスポンスの形を `{ theme }` だけに固定し、テストで他の項目が出ないことを確かめる。

### Decision: OS 配色の解決を JS で行い、CSS は1組の変数にする
- **Context**: OS 規定（`system`）の表示を、CSS の `@media` で扱うか、JS で解決するか。
- **Selected Approach**: JS で `matchMedia` を読み、解決後の `light` または `dark` を `<html>` の `data-theme` に書く。CSS は `:root`（ライト）と `:root[data-theme="dark"]` の2か所だけにする。
- **Rationale**: ダーク用の変数を1組に保つ。`theme-color` と `color-scheme` も同じ解決値から決まり、一貫する。
- **Trade-offs**: JS が動かない環境では OS 規定が効かない。SPA は JS 前提のため許容する。

### Decision: 取得の失敗時は「OS 規定」で続行し、保存の失敗時は差し戻す
- **Context**: 要件 3.4 と 2.3。
- **Selected Approach**:
  - 取得（GET）が失敗・不正な応答のとき、`system` として描画する。
  - 保存（PUT）が失敗したとき、切り替え前のテーマへ戻し、エラーを通知する（既存の `ToastProvider` と `describeApiError` を使う）。
- **Rationale**: 取得の失敗で空白が続くと、表示できなくなる。保存の失敗は、利用者に「保存されていない」ことを必ず伝える。

### Decision: 画面確認は `web/tests/screens/` の Playwright で行い、API はモックする
- **Context**: 利用者は、E2E の画面確認を設計で決めることを求めた。既存の `e2e/hosted` は compose スタックを前提とし、テーマの確認には重い。
- **Selected Approach**:
  - `web/playwright.screens.config.ts` と `web/tests/screens/theme.spec.ts` を作る。
  - `vite preview` で配信し、`page.route` で `/api/v1/ui-preferences` と認証系の応答をモックする。
  - 確認項目: ライト・ダーク・OS 規定（`colorScheme` を切り替えて確認）の3通り。ログイン前の初期設定・ログイン画面、ダッシュボード。取得中の空白（応答を遅らせる）。保存の失敗時の差し戻し。
  - 本文の文字と背景のコントラスト比は、`getComputedStyle` の値から算出して 4.5:1 以上を確かめる（要件 5.1）。
  - スクリーンショットは `e2e/artifacts/screens/` に保存する（既存の成果物の置き場と同じ階層）。
- **Rationale**: 画面の見た目と取得のタイミングは、実際のブラウザでしか確かめられない。API をモックすれば、VPN やコンテナを起動せずに済む。
- **Trade-offs**: 実際の API との結合は確かめない。API との結合は、api 側の route 統合テストと、既存の hosted E2E（CI）で担う。

## Risks & Mitigations
- **直接書かれた色の置き換え漏れ**（約44か所）— 置き換えの対応表を実装時に作り、コントラスト確認を画面確認で行う。
- **ダークの配色の不足**（コントラスト・状態色）— 初期値は `design.md` に示すが、画面確認で値を調整する。
- **Service Worker の古い CSS**（既存の挙動）— 今回は変更しない。必要なら SW のキャッシュ版を上げる作業を別に行う。
- **取得の遅延による空白の長さ** — 要件 4.1 に従い空白は許容する。取得が極端に遅い場合の打ち切りは行わない（要件に無いため）。
- **`e2e-tests` の既存の画面確認との干渉** — 既存の hosted E2E がテーマの追加で影響を受けるかは、実装時に `e2e/hosted/specs` で確認する。

## References
- [WebStandards: prefers-color-scheme](https://developer.mozilla.org/docs/Web/CSS/@media/prefers-color-scheme) — OS 配色の検知（JS の `matchMedia` でも同じ条件を使う）
- [MDN: color-scheme](https://developer.mozilla.org/docs/Web/CSS/color-scheme) — フォームやスクロールバーの配色を揃える
- [WCAG 2.2: Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum) — 本文 4.5:1 の根拠
