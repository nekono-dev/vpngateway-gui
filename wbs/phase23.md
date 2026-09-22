# Phase 23: ベンダー選択のプルダウン化・PWA対応・モバイル表示の改善

## 目的

利用者からの指摘（VPNベンダー選択カードの画面のデッドスペース、入力欄の枠線色が他のUIと系統が異なる紫色であること、スマートフォンでのスクロール防止の継続確認、PWA未対応）を受け、Web UIの表示のみを改善する。機能追加・API変更は行わない。

## 前提

- Phase 22（モバイル表示・入力欄の視認性改善）が完了していること。

## スコープ外

- API・データモデルの変更（本フェーズはWeb UIの表示のみ）。
- 配信のHTTPS化（PWAのService Workerを実機で完全に有効化するには必要だが、利用者へ確認のうえ本フェーズはスコープ外とした。詳細は`specs/webserver/design.md`「PWA対応」の制約を参照）。

## 主要タスク

- [x] `specs/webserver/requirements.md`「ベンダー選択のプルダウン化・PWA対応・モバイル表示の改善（Phase 23）」に要件を追記
- [x] `specs/webserver/design.md`に実装方針を追記
- [x] `ProviderSelector.tsx`をラジオボタンの並びからプルダウン（`<select>`）へ変更
- [x] `SessionCard.tsx`を`Fragment`化し、単発ボタン（ログアウト／URL提示型ログイン）を`session-action`、それ以外（状態表示・フォーム・制限理由）を`session-extra`として分離
- [x] `styles.css`に`.provider-card`（CSS Grid）・プルダウンのテキストボックス風装飾（`appearance: none`＋自前の矢印）・`--input-border`のグレー化・モバイル幅（`max-width: 420px`）での余白詰め・縦積み・`overscroll-behavior-y: none`を追加
- [x] PWA資材（`web/public/manifest.webmanifest`・`sw.js`・アイコン一式）を追加し、`index.html`・`main.tsx`から参照・登録する
- [x] 既存コンポーネントテスト（`App.providers.test.tsx`）をプルダウン操作（`getByRole("combobox")`・`selectOptions`）へ追従修正
- [x] 検証環境（実機、`ubuntu@192.168.3.240`）のブラウザ（Playwright、デスクトップ幅・モバイル幅を含む）で確認、恒久的なE2Eスクリプト（`e2e/phase23/webgui-phase23.mjs`）を追加

## 完了基準

- `web`のユニット/コンポーネントテスト（`npm test`）がFAIL 0であること。
- 検証環境のブラウザで、①VPNベンダーの選択がプルダウンになっていること、②プルダウンがシステムUIではなくテキストボックス風に装飾されていること、③プルダウンの隣（同じ行）にログイン/ログアウトボタンが配置されること、④入力欄・プルダウンの枠線色が紫ではなくグレー系であること、⑤デスクトップ幅・モバイル幅（375x667・320x568）のいずれでもページ全体がビューポートに収まり横方向のはみ出しも無いこと、⑥PWAのmanifest・Service Worker・アイコンが配信されることを確認する。

## 検証手法

`web`のユニット/コンポーネントテスト（`npm test`）、`npm run build`・`tsc`（型チェック）、`scripts/check-vendor-neutrality.mjs`を実行する。実機は検証環境（`ubuntu@192.168.3.240`）の`web`コンテナを本フェーズの資材で再ビルド・再起動し、Playwrightで複数のビューポート（デスクトップ幅1280x800・モバイル幅375x667・320x568）を用いて、プルダウンの存在・装飾（`getComputedStyle`の`appearance`・`borderColor`）・行内配置（プルダウンとボタンの`getBoundingClientRect`の重なり）・ページ全体の高さ（`scrollHeight`と`clientHeight`の比較）・横方向のはみ出し（`scrollWidth`と`clientWidth`の比較）・PWA資材のHTTP応答を確認する。ベンダー切替を伴う確認は、検証開始時点の選択中ベンダー（Proton VPN）へ戻すところまでをスクリプトに含める。

## 検証結果（2026-09-22、検証環境ubuntu@192.168.3.240）

- `npm test`（web）: FAIL 0（103件PASS。プルダウン操作へ追従した`App.providers.test.tsx`の修正を含む）。
- `tsc -p tsconfig.json --noEmit`・`npm run build`: エラー無し。`dist/`に`manifest.webmanifest`・`sw.js`・`icons/`が含まれることを確認。
- `scripts/check-vendor-neutrality.mjs`: OK（禁止語12語）。
- 実機（`web`コンテナのみ本フェーズの資材で再ビルド・再起動。`api`・`proxy`・`runner-*`は未変更のため未再ビルド）をPlaywright（`e2e/phase23/webgui-phase23.mjs`、デスクトップ幅1280x800・モバイル幅375x667・320x568）で確認:
  - VPNベンダーの選択が`role="combobox"`のプルダウンになっており、旧`role="radiogroup"`は存在しないことを確認。
  - プルダウンの`getComputedStyle`で`appearance: none`（システムUIの矢印を消している）、`borderColor: rgb(110, 119, 129)`（新しい`--input-border`。旧`rgb(110, 64, 201)`＝紫ではない）を確認。
  - AdGuard VPN（ログイン済み）へプルダウンで切替後、ログアウトボタンがプルダウンと同じ行・右側に配置されることを`getBoundingClientRect`の重なりで確認。
  - いずれのビューポート（デスクトップ幅・モバイル幅375x667・320x568）でも、`document.documentElement.scrollHeight`が`clientHeight`を超えず（ページ全体がビューポートに収まる）、`scrollWidth`が`clientWidth`を超えない（横方向のはみ出しが無い）ことを確認。
  - `/manifest.webmanifest`・`/sw.js`・`/icons/icon-192.png`・`/icons/icon-512.png`・`/icons/apple-touch-icon.png`がいずれもHTTP 200で配信されることを確認。
  - **PWAのService Worker有効化について**: `window.isSecureContext`が`false`（配信が`http://192.168.3.240:8080`というLAN IPへの素のHTTPのため）となり、`navigator.serviceWorker`自体が存在しないことを確認した（ブラウザのセキュアコンテキスト要件によるもので、実装の不備ではない）。利用者へ確認のうえ、配信のHTTPS化は本フェーズのスコープ外とした（`specs/webserver/requirements.md`「PWA対応」参照）。manifest・アイコンによる基本的な識別（タブアイコン・追加時の名称）は機能する。
  - 検証はベンダー切替（Proton VPN→AdGuard VPN→Proton VPN）を伴うため、検証後に元のベンダー（Proton VPN。検証開始時点の選択中ベンダー）へ戻し、環境の状態（VPN切断のまま）を変えないようにした。恒久的なE2Eスクリプトとして再実行してALL PASSを確認。

## 次フェーズへの申し送り

- 検証環境（`ubuntu@192.168.3.240`）の`web`コンテナは本フェーズの資材で更新済みのまま残している（`api`・`proxy`・`runner-*`はPhase21時点のまま）。選択中のベンダーはPhase22終了時と同じProton VPN（未ログイン、VPN切断）へ戻して放置した。
- PWAを実機で完全に機能させる（Service Workerを有効化し、ホーム画面からのオフライン起動を可能にする）には、配信のHTTPS化（リバースプロキシでの自己署名証明書の追加等）が別途必要。利用者には確認済みで、現時点ではスコープ外としている。将来HTTPS化する際は、本フェーズで追加した`main.tsx`の登録コード・`sw.js`・`manifest.webmanifest`はそのまま機能する見込み（追加の実装変更は不要と想定されるが、HTTPS化時に実機で改めて確認すること）。
