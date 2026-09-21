# Phase 14: プランで接続できる接続先の参考表示

**【2026-09-21追加】** Phase 10（Proton VPN）の実機検証で、無料版は接続先を選べず自動接続のみだと分かった。利用者から「無料版で接続できる国の情報を取得して、Web UIに表示したい」という要望があり、追加する。実施順は他のPhaseと独立（Phase 12・13の実施状況に依らず実施できる。ただしPhase 12でベンダーバンドル化する際、本フェーズの`docker-compose.yml`の記述（キャッシュのマウント）とプロファイルの宣言は、そのバンドルへ移す対象）。

## 目的

接続先を選べないプランで、自動接続でどの国・都市のサーバに繋がりうるかを、Web UIに参考として表示する。要件は`specs/requirements.md`「プランで接続できる接続先の参考表示」、設計は`specs/apiserver/design.md`「プランで接続できる接続先の参考一覧」・`specs/webserver/design.md`「プランで接続できる接続先の参考表示の実装方針」。

## 前提

- Phase 9（プラン制限の判定）・Phase 10（Proton VPNのランナー・ログイン）完了。
- 取得元: Proton VPN CLIがキャッシュするサーバ一覧（`serverlist.json`。CLIの`countries list`・`servers`には無料の別が無い）。実機で、`Tier`が`0`のサーバが無料、`Status`が`1`がオンラインと確認した（2026-09-21。無料版のログイン済みアカウントで10か国・都市付き）。

## スコープ外

- 接続先の指定（無料版では不可のまま）。
- サーバの負荷・ドメイン・IPの表示（APIの応答にも含めない）。
- 有料プランの一覧（有料は接続先リストが使える）。
- キャッシュの更新の制御（CLIが更新する）。

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件・設計・タスクの記述（`specs/requirements.md`・`specs/apiserver/`・`specs/webserver/`）。**実装は、先に実装へ着手してしまい、指摘を受けて文書を先に書いた。設計は`Phase 12`（ベンダー非依存）の方針に合わせ、ベンダー固有の形式をコードに持たず、プロファイルの宣言で表す形にした。**

### api（`specs/apiserver/tasks.md`）
- [x] プロファイルスキーマ・`plan-locations.ts`（宣言に従う抽出・置き場の外の拒否・空へのフォールバック）・`GET /v1/connection/available-locations`・単体/統合テスト（api 230件）
- [x] `docker-compose.yml`へキャッシュの読み取り専用マウントと`PROVIDER_CACHE_DIR`、Proton VPNプロファイルの宣言

### web（`specs/webserver/tasks.md`）
- [x] orval再生成・`useAvailableLocations`・`AvailableLocations`・`LocationList`への組み込み・コンポーネントテスト（web 94件）

### 検証
- [x] 実機（検証環境・Proton VPN無料アカウント）で、`GET /v1/connection/available-locations`が10か国（都市付き。日本語の国名、五十音順）を返す（2026-09-21）。
- [ ] 実機のWeb UI（ブラウザ）での表示確認（利用者の目視。コンポーネントテストでは確認済み）。

## 完了基準

- 無料プランのProton VPNで、接続先リストの枠に理由文と、接続できる国・都市の参考一覧が出る（選択・操作はできない）。
- 接続先リストが使えるプロバイダ・プランでは、取得も表示もしない。取得に失敗・空でも通知・エラーにせず、他の操作に影響しない。
- 応答にサーバのドメイン・IP等を含まない。宣言の`file`が置き場の外を指せない。

## 次フェーズへの申し送り

- （実装中に判明した点）(1)検証環境で、利用者が別途Proton VPNへ再ログインしていた（一覧はログイン中のプランでのみ返る。未ログイン・有料は空）。(2)国名の並びは`Intl.DisplayNames`（ja）・五十音順（アメリカ合衆国が日本より前）。(3)Phase 12のバンドル化で、`docker-compose.yml`の`api`のマウント（`proton-cache`→`<PROVIDER_CACHE_DIR>/protonvpn`）はバンドルのcompose fragmentへ移す。
