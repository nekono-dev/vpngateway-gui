# Brief: vendor-live-e2e

## Problem
本番の runner（実 VPN CLI を含むイメージ）が、実際の VPN に接続し、出口 IP を変えられることを、自動テストで確認できていない。
hosted runner の E2E（`e2e-tests`）はモックの CLI を使うため、実 CLI の挙動（ログイン・接続・切断・経路の変更）は検証できない。
この検証は、利用者にとっての中心的な価値（VPN が実際に効くか）に直結する。

## Current State
- `e2e-tests`（hosted runner）は、モック CLI を使う。実アカウントは使わない（要件 1.6）。
- 検証サーバ（aitest、192.168.3.240）には、実 runner のスタック（api・proxy・runner-protonvpn・runner-adguardvpn・web）が稼働している。
  Proton の CLI（`/usr/bin/protonvpn`）は導入済み。Proton の状態は `Disconnected`。
- AdGuard の runner は、ログアウト状態（`You are not logged in`）。ログインは device flow（auth.adguard.io でのブラウザ認証）で、パスワードを環境変数から渡す自動化はできない。
- Proton の CLI は、runner コンテナの中（D-Bus・keyring の環境）で動く前提。ホストの root から `docker exec` で直接叩くと、`config list` が例外で失敗した（確認済み）。
- 開発ホスト（devSrv）は、Proton の CLI が未導入。実接続でデフォルト経路が変わるため、この機では実施しない。

## Desired Outcome
検証サーバ（aitest）で、実 runner を使い、次が自動テストで確認できる。
- Proton: 準備処理で端末から資格情報と 2FA のコードを入力してログインし、試験は自動で VPN に接続する。出口 IP が VPN のものに変わり、切断すると元に戻る。
- AdGuard: 初回だけ手動で device 認証を行い、保持したセッションで接続・切断を自動テストでき、出口 IP が変わる。
- 失敗（資格情報の誤り・接続の失敗）は、テストの失敗として報告される。

## Approach
- 本番と同じ runner イメージを aitest 上で動かし、テストは API（`POST /v1/session`・`PUT /v1/connection`・`GET /v1/connection`）経由で操作する。CLI を直接叩かない。
- **準備処理（prepare）**: 開発サーバの端末から、試験の直前に実行する。いずれの runner についても、端末からログイン処理を行う。
  - Proton: 資格情報と 2FA のコードを、端末の対話入力で受け取り、検証サーバの runner へ API（`POST /v1/session`）でログインする。資格情報は保存しない。
  - AdGuard: device 認証の URL とコードを端末に表示し、承認の完了を待つ。承認は開発者が別の端末のブラウザで行う（検証サーバには接続しない）。
  - 準備処理は、検証サーバ上の作業を手で行わない。検証サーバの操作は、すべて開発サーバからの API 経由とする。
- **試験**: 準備処理の直後に、開発サーバから自動実行する。準備処理で作ったログイン状態を使い、人の操作なしで接続・切断・出口 IP の確認を行う。
- 資格情報は、準備処理の端末入力で受け取る。環境変数で渡す場合も、値はリポジトリ・ログ・成果物に残さない。
- Proton の 2FA は、準備処理で人が入力する（ユーザーの選択）。無人の完全自動化はできない。
- AdGuard は、初回の device 認証の後、認証情報を保持する volume（`adguard-data`）を使う。期限が切れたら、再度手動で認証する。
- 出口 IP は、テストの実行環境から外部の IP 確認サービス（既定の `verifyEchoUrl`）で取得し、接続前後の値を比べる。

## Scope
- **In**: Proton の実 runner のログイン（2FA の手動入力を含む）・接続・切断・出口 IP の確認。AdGuard の実 runner の（保持セッションでの）接続・切断・出口 IP の確認。資格情報の供給方法。失敗時の報告。
- **Out**: GitHub-hosted の E2E（`e2e-tests`）。CI での実行（資格情報を扱うため、CI では実行しない）。devSrv での実行。AdGuard の初回 device 認証の自動化。無料プランの接続先の制限（有料プランを前提とする。プラン種別は未確認）。VPN サーバの性能の評価。

## Boundary Candidates
- 資格情報の供給と保管（環境変数、aitest 上のファイル、権限）
- 実 runner の操作（API 経由のログイン・接続・切断）
- 出口 IP の確認（実インターネットへの到達）
- 手動の工程（Proton の 2FA の入力、AdGuard の初回 device 認証）と、その失敗時の扱い

## Out of Boundary
- hosted runner の構成（モック CLI・netns の模擬）は `e2e-tests` の責務。本 spec は変更しない。
- CI の起動条件と権限（`cicd` の責務）。本 spec は CI に載せない。

## Upstream / Downstream
- **Upstream**: `e2e-tests`（テスト基盤・Playwright の設定・API クライアントの型を再利用する。モック構成は使わない）。`vendors/protonvpn`・`vendors/adguardvpn`（実 runner のイメージ）。aitest の既存の導入（本番と同じ構成）。
- **Downstream**: なし。

## Existing Spec Touchpoints
- **Extends**: なし。`e2e-tests` の要件・設計は変更しない。
- **Adjacent**: `e2e-tests`（要件 1.6 と Non-Goals は、実 VPN アカウントを使わないことを前提にしており、本 spec を同じ spec に入れると矛盾する）。`cicd`（本 spec を CI から呼ばないこと）。

## Constraints
- リポジトリは PUBLIC。資格情報・2FA のコード・セッションの情報を、コミットやログに残さない。
- aitest は共有の検証サーバ。他の runner とコンテナが稼働し、ディスクの残りは 18G。テストの成果物は、容量を圧迫しない範囲にする。
- 実接続で aitest のデフォルト経路が変わる。SSH は LAN の接続経路（接続済みの経路）で維持されると見込むが、未確認。
- AdGuard のログインは device flow のみ。自動化できるのは、保持したセッションの範囲だけ。
- Proton の 2FA は実行ごとの人手が必要。実行時間の見積もりと、コード入力の待ち時間（TOTP の有効期間）を考慮する。
- 無料プランと有料プランで、接続先の選択可否が異なる（`profile.json` の restrictions）。対象プランは未確定。

## Verification Pending（実施できるかの確認。資格情報が必要なもの）
1. Proton: 資格情報と 2FA で、runner の `signin` が成功すること（API 経由）。
2. Proton: 接続後、出口 IP が変わり、切断で元に戻ること。
3. Proton: 接続中に aitest の SSH が維持されること（デフォルト経路の変更の影響）。
4. AdGuard: 手動の device 認証の後、runner コンテナを再作成しても、セッションが保持されること。
5. 対象プランの種別（無料か有料か）。
