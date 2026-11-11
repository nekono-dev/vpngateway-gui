# Roadmap

## Overview
現行の実装（コード・設定・スクリプト）を正として、E2Eテストと、そのE2Eを含むCI（テスト・E2E）を整備する。
E2Eは、Web UI・API・ゲートウェイ（透過ゲートウェイ・Kill Switch・DNS中継・明示的プロキシ）・インストーラの、
ネットワーク系を含む全範囲を対象とする。実行は GitHub-hosted runner 上で行い、検証サーバ（192.168.3.240）と LXC は使わない。

既存のE2Eスイート（git HEADの `e2e/` 55ファイル）は、作業ツリーで削除済み（ユーザーの意図的な削除）。HEADから復元せず、
現行の実装を正として作り直す。ドキュメント・コード中コメントは、仕様の根拠として参照しない。

## Approach Decision
- **Chosen**: GitHub-hosted runner（ubuntu-latest）上で、docker compose（実装の `compose/*.yml` と `docker-compose.e2e-mock.yml`）を起動し、
  network namespace で LAN クライアントを模擬する。Web UI の操作は Playwright（1.63.0、リポジトリの devDependency として固定）で行う。
  ベンダーは実装のバンドル形式に従うモック（mockproton 相当）を使う。
- **Why**: リポジトリが PUBLIC のため、外部PRのコードを自前ホストで実行しない。検証サーバは他プロジェクトと共用で、空きディスクが少ない。
- **Rejected alternatives**:
  - 検証サーバの self-hosted runner で既存のLXC方式を使う: 公開リポジトリで外部PRのコードが共用サーバ上で動くおそれがあるため却下。
  - GitHub-hosted runner上でLXD（LXC）を動かす: ホスト上での安定性が未確認で、実装の検証手順が複雑になるため却下（未検証のまま採用しない）。

## Scope
- **In**: Web UI の主要フロー、API 経由の接続・ロケーション・プロバイダ切り替え、ゲートウェイの挙動（LAN クライアント経由の疎通・遮断・DNS中継・明示的プロキシ）、
  インストーラの導入・アンインストール・再起動（hosted runner で成立する範囲）、E2E の基盤（compose・モックベンダー・Playwright の起動）、
  CI でのテスト・E2E の自動実行。
- **Out**: 実VPNベンダー（Proton・AdGuard）への実接続と実アカウント、実LAN・Raspberry Pi 実機、macvlan など LXC 固有の構成、
  検証サーバ（192.168.3.240）上での実行、検証サーバへの自動デプロイ、GHCR 等へのイメージ公開、self-hosted runner の利用。

## Constraints
- リポジトリは PUBLIC。秘密情報（`.env` の VERIFY_* 等）を CI に渡さない。外部 fork の PR に secrets を渡さない（`pull_request_target` と PR の head の checkout を組み合わせない）。
- ネットワーク検証には NET_ADMIN 相当の権限が必要。GitHub-hosted runner（ubuntu-latest）で nftables・netns・Docker の権限が成立することは、PoC（ブランチ `poc/hosted-runner-netns`）で確認済み。実 compose スタックでの確認は design 段階で行う。
- Playwright の版は 1.63.0 に固定（既存の `installer-check.yml` の `PLAYWRIGHT_VERSION` と一致させる）。
- 既存の `installer-check.yml` と `release-installer.yml` の挙動（検査・install.sh の生成と頒布）を壊さない。
- ユーザーの指示: 作業は現行の実装を正とし、コード中コメントとドキュメントは無視する。

## Boundary Strategy
- **Why this split**: E2E の中身（何を検証するか・どう模擬するか）と、CI の運用（いつ・どこで走らせ、結果をどう報告するか）は変更理由が異なるため分ける。
  E2E の実行エントリポイントを先に確定させ、CI がそれを呼ぶ形にする。
- **Shared seams to watch**: E2E の実行エントリポイント（コマンド名・終了コード・成果物の場所）。CI 側はこの契約にだけ依存する。
  `package.json` のスクリプト（`test`・`test:install`・`check:neutrality`）と `installer-check.yml` の再利用関係。
- `e2e/common/`（API クライアント・API の型・報告の契約。所有は `e2e-tests`）。`e2e-tests`（`e2e/hosted/`）と `vendor-live-e2e`（`e2e/vendor-live/`）の両方が使う。契約を変えると両方の再検証が必要。
- `package.json`（devDependencies と scripts）と `.gitignore` は `e2e-tests` が所有する。`vendor-live-e2e` はこれを変更しない。

## Specs (dependency order)
- [ ] e2e-tests -- 現行実装に基づくE2Eテスト（Web UI・ゲートウェイ・インストーラ）と、hosted runner 上での実行基盤。Dependencies: none
- [ ] cicd -- push・PR でのテスト・検査・E2E の自動実行、失敗時のレポート保存、既存ワークフローとの統合。Dependencies: e2e-tests

## Phase 2（手動実行の実 VPN 試験。CI には載せない）

## Phase 2 Specs
- [ ] vendor-live-e2e -- 検証サーバ（aitest）の実 runner を、端末から入力する資格情報と 2FA（準備処理）・AdGuard の保持セッションで、実 VPN に接続して出口 IP を確認する試験。Dependencies: e2e-tests（`e2e/common/` を共有。`e2e/hosted/` とモック構成は使わない）

### Phase 2 の制約
- `e2e-tests` の要件 1.6・Non-Goals（実 VPN アカウントを使わない）は変更しない。実 VPN の試験は別 spec に分ける。
- 本 Phase の試験は CI で実行しない（資格情報を扱うため）。`cicd` の対象外。

## Phase 3（都市の選択と、都市単位の距離順）

### Phase 3 Existing Spec Updates
- [ ] location-distance-sort -- 国と都市の座標を、配布物に同梱した Natural Earth の公開データから引き、利用者の国の首都からの距離で、国の行と都市の行を並べる。設定画面に利用者の場所のタブを追加する。距離は小数点以下第一位まで表示する。承認前（requirements-generated）のため、要件の見直しから行う（2026-11-08 の判断で、2 spec は統合せず別々に進める）。Dependencies: none（都市の一覧の入力の形（国コード・国名・都市名）は location-city-selection と揃える）

### Phase 3 Specs
- [ ] location-city-selection -- ProtonVPN と AdGuard VPN で、同じ UI の国の行の下に都市を並べ、国または都市を指定して接続する（ProtonVPN の国ごとの都市の一覧の取得と保存、AdGuard VPN の一覧の組み替え、profile の宣言、E2E のモック）。Dependencies: none

### Phase 3 の制約
- `location-distance-sort` の要件は、都市の一覧が存在する前提で見直す。国と都市の座標は、配布物に同梱した Natural Earth の公開データ（パブリックドメイン）から引く。実行時に外部へ送る情報はない。距離の基点は、利用者の国の首都（都市単位の基点にはしない）。GeoNames は、利用者にアカウントを求めるため見送った（2026-11-08）。
- 2 spec の依存は一方向にしない。並べ替えの入出力（国コード・国名・都市名、並べ替えた順序・距離）の形を両 spec に書き、揃えて承認する。
- AdGuard VPN の既存の平らな都市の一覧は、`location-city-selection` で国の下に都市を並べる形に組み替える（両プロバイダで UI を揃える）。

## Phase 4（二段接続。バックエンドを先に扱い、画面は保留）

### Phase 4 Specs
- [ ] multihop-backend -- 二段接続のバックエンド（段ごとのネットワーク・MAC の固定・中継、ゲートウェイの複数トンネル、入口の 3 方式（ランダム既定・プロバイダ選択は出口と同じ提供元・手動）、段の失敗時の動作（既定は遮断）、接続 API と接続状態）。Dependencies: location-city-selection（入口の候補の一覧）。実装は location-distance-sort と location-city-selection の対応後に行う（両者と接続のコードが重なるため）

### Phase 4 の制約
- 画面（`multihop-ui`）は保留。タブ・スイッチ・一覧の構成は、既存の spec（`location-city-selection`・`location-distance-sort`）の変更後に、改めて discovery から始める。利用者の意思の記録は `.kiro/discovery/multihop-user-intent.md`。
- 実験の根拠は `.kiro/discovery/multihop-chain-input.md`（section 14〜16 が成立の根拠。section 9〜13 は namespace 方式の不成立の記録）。
- 異なるプロバイダの組み合わせは `multihop-backend` の範囲に含める（利用者の決定）。今の API と状態モデルは 1 プロバイダ前提のため、段ごとに提供元を持つ形へ変える。実機での共存（同じ経路表・MTU・インターフェース名）は未検証で、design 段階で確認する。
- 段数は 2 段に限らず n 段に対応する（利用者の決定）。段数の上限は設定値とし、値は design で決める。検証は 2 段で行い、3 段以上の実機確認は design で範囲を決める。
