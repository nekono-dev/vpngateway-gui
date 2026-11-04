# Brief: e2e-tests

## Problem
現行の実装（Web UI・API・ゲートウェイ・インストーラ）を、結合した状態で検証する仕組みがリポジトリに無い。
既存のE2Eスイート（git HEADの `e2e/`）は LXC 前提で、作業ツリーでは削除済み。
公開リポジトリの CI で走らせられる形になっていないため、変更の回帰をリリース前に検出できない。

## Current State
- 単体テストは `proxy`・`api`・`web` にあり、`npm test` で実行される。インストーラは `installer/tests/run.sh` で検査される。
- `docker-compose.e2e-mock.yml` は残っており、Web UI のポート（18080）と、E2E 用ベンダーバンドルのディレクトリ差し替えを定義する。
  ただし、参照先の `e2e/lib/e2e-vendors.sh` と `e2e/vendors/mockproton` は作業ツリーに無い（削除済み）。
- ゲートウェイ（`compose/gateway.yml` の proxy は `network_mode: host`、`cap_add: NET_ADMIN`）と、
  ランナー（ベンダーCLI の分離実行）を含む結合検証は、現在どこにも自動化されていない。
- HEAD の `e2e/` は phase3〜phase36 のシナリオを持つ（Web UI、ゲートウェイ、DNS中継、明示的プロキシ、プロバイダ切り替え、
  インストーラ、アンインストール、再起動、オペレーター認証、狭幅レイアウト、回線一覧）。ユーザー指示により、この内容は仕様の根拠にせず、実装から作り直す。

## Desired Outcome
GitHub-hosted runner 上で、現行実装に基づく E2E が、単一のエントリポイントから再現実行できる。
- Web UI の主要フロー（初期設定・ログイン・ダッシュボード・接続・ロケーション・プロバイダ・設定・オペレーター認証）が通る。
- ゲートウェイを経由する LAN クライアントで、透過ゲートウェイ・Kill Switch・DNS中継・明示的プロキシの疎通と遮断が確認できる。
- インストーラの導入・アンインストール・再起動が、hosted runner で成立する範囲で確認できる。
- 失敗時に、どのシナリオが落ちたかと、Playwright のレポートが分かる。

## Approach
- GitHub-hosted runner（ubuntu-latest）上で、`compose/*.yml` と `docker-compose.e2e-mock.yml` を使って docker compose を起動する。
- LAN クライアントは network namespace（または同等の隔離コンテナ）で模擬する。
- Web UI の操作は Playwright 1.63.0（リポジトリの devDependency として固定）で行う。
- ベンダーは、実装のバンドル形式（`vendors/<ID>/profile.json`・`compose.yml`）に従うモックを使う。
- LXC・macvlan・検証サーバ（192.168.3.240）は使わない。

## Scope
- **In**: 上記 Desired Outcome の各フロー。E2E の基盤（compose の組み立て・モックベンダー・Playwright の起動と終了処理）。
  E2E の実行エントリポイント（コマンド名、終了コード、成果物の出力先）。
- **Out**: 実VPNベンダーへの接続と実アカウント、実LAN・Raspberry Pi 実機、LXC・macvlan 固有の構成、検証サーバ上での実行、CI の起動条件とワークフロー定義（`cicd` の責務）。

## Boundary Candidates
- Web UI・API のフロー（Playwright）
- ゲートウェイの挙動（netns による LAN クライアント模擬）
- インストーラのライフサイクル（導入・アンインストール・再起動）
- E2E 基盤（compose の組み立て、モックベンダー、実行エントリポイント）

## Out of Boundary
- CI のトリガー、権限、並列化（`cicd` spec）
- 単体テスト（既存の `npm test` の範囲）
- インストーラ自体の仕様変更

## Upstream / Downstream
- **Upstream**: `installer/setup.sh`、`compose/*.yml`、`docker-compose.e2e-mock.yml`、`vendors/` のバンドル形式、`web/`（SPA）、`api/`（REST）、`proxy/`（ゲートウェイ）
- **Downstream**: `cicd`（E2E の実行エントリポイントを CI から呼ぶ）

## Existing Spec Touchpoints
- **Extends**: なし（既存の spec は無い）
- **Adjacent**: `.github/workflows/installer-check.yml`（インストーラ検査。E2E と重複させない）

## Constraints
- リポジトリは PUBLIC。E2E の中で秘密情報（`.env` の VERIFY_* 等）を使わない。テスト用の認証情報はテスト内で生成する。
- ネットワーク検証に必要な権限（NET_ADMIN、netns、nftables）は、GitHub-hosted runner（ubuntu-latest）で成立することを PoC で確認済み（ブランチ `poc/hosted-runner-netns`、run 41273196695）。確認内容: sudo（パスワード不要）、netns による透過ゲートウェイの模擬（NAT・Kill Switch）、NET_ADMIN と network_mode: host のコンテナからの nftables 操作、host-gateway、Playwright 1.63.0 の chromium 起動。
- PoC で未確認の項目: 実際の proxy イメージと compose スタック全体の起動、実装の nftables ルールそのものの検証、E2E 全体の実行時間。これらは design 段階で確認する。
- Playwright は 1.63.0 に固定する。
- ユーザーの指示により、コード中コメントとドキュメントは仕様の根拠にしない。判断は実装から行う。
- 削除済みの `e2e/` は HEAD から復元しない（ユーザーの指示）。
