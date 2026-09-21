# Phase 13: インストーラと頒布（クリーンなベアメタルへの1コマンド導入）

**【2026-09-21追加】実施順は Phase 12 の直後**（`… → 12 → 13 → 6 → 7`）。Phase 12のベンダーバンドル（`vendors/<ID>/`）を前提にする。

## 目的

クリーンなDebian系ベアメタルで、`curl`1コマンドでプラットフォームを導入・起動し、有効にするベンダーを1つの引数で指定できるようにする。「何をインストーラが行い、どう操作すればプラットフォームの導入・ベンダーの有効化ができるか」を1つの入口に集約する。

要件は`specs/requirements.md`「インストール」、設計は`specs/design.md`「インストーラと頒布（Phase 13）」。

## 前提

- Phase 12完了（ベンダーバンドル、`COMPOSE_FILE`合成、`VPN_PROVIDERS`必須）。
- クリーンなUbuntu 24.04の検証環境（LXC。`security.nesting=true`。`e2e/lxc/`）。

## スコープ外

- アンインストール、IPv6、ホストのファイアウォール（ufw等）との調整。
- Debian・Raspberry Pi OSでの検証（検証環境はUbuntu 24.04のみ。`nftables.service`の`flush ruleset`による起動時ルールの消失は未検証）。
- 無効にしたベンダーの`install-host.sh`の取り消し（`uninstall-host.sh`）。ベンダーのCLIがホスト導入を要するようになった時点で設計する。
- インストーラの署名（`install.sh.sha256`の添付までとする）。

## 決定事項（利用者への確認結果、2026-09-21）

| 項目 | 決定 |
|---|---|
| 配布・実行形態 | `curl`一発のブートストラップ。CIがブランチ・タグに紐付けて生成し、GitHub Releaseなどで頒布する。`git clone`まで含めて全て実行する |
| Dockerの導入 | Docker公式リポジトリ |
| ベンダー固有のホスト側の前提 | 共通インストーラから分割（`vendors/<ID>/install-host.sh`） |
| インストーラの構成 | シンプルにする（従来の`install/`の4本を1本へ統合） |

## 設計上の判断（本文書の作成時、確認なしに決めた点。誤りがあれば指摘を受けて改訂する）

- インストーラは2層: 頒布される薄いブートストラップ（取得先のコミットを固定し、SHAを照合して、本体を実行）と、リポジトリ内の本体`install/install.sh`。本体はソースと同じ版で動くため、手動でcloneした場合にも使える。
- 取得先の既定は`/opt/vpngwgui`（E2Eの検証環境と同じ）。運用ディレクトリ＝取得先で、`.env`もここに置く。
- ベンダーの決定の優先順: `--providers` ＞ `.env`の既存値（引数なしの再実行は更新のみ）＞ 端末での対話（`/dev/tty`。`curl | sh`では標準入力がパイプのため）＞ 失敗。
- Dockerが既に動く（`docker compose version`が通る）場合は導入しない（別の方法で入れた環境を壊さない）。
- CIはブランチ・タグの両方でブートストラップを生成する。ブランチはartifact、タグはRelease（`install.sh`と`.sha256`）。

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件・設計・タスクの反映（本ファイルを含む）。

### インストーラ
- [ ] `install/install.sh`（本体）: 事前検査・依存とDocker公式リポジトリ・sysctl・起動ガード・`.env`・ベンダーの決定・`install-host.sh`のフック・起動と待機・完了表示。従来の`install/`の4本を削除し、参照（compose・仕様書・E2Eのコメント）を更新。
- [ ] `install/bootstrap.sh`（頒布物の雛形）と`install/build-bootstrap.sh`（置換・置換漏れの検査）。
- [ ] `.github/workflows/installer.yml`（`sh -n`・shellcheck・`npm test`・ブートストラップの生成・ブランチのartifact・タグのRelease）。
- [ ] `README.md`にインストール手順（1コマンド・`--providers`・更新・ベンダーの変更）を記載。

### 検証
- [ ] クリーンなUbuntu 24.04（LXC）で、ブートストラップ（ローカルのリポジトリをREPO_URLにしたもの）から導入・起動し、Web UIが応答する。
- [ ] `--providers`の指定・変更（追加・削除。無効にしたランナーの停止）、引数なしの再実行（既存値の保持・更新）、対話選択、`.env`の保持（`LAN_IFACE`）。
- [ ] `install-host.sh`のフック（テスト用バンドルで、実行される・失敗で中止する）。
- [ ] 導入後のE2E（`e2e/phase3`の一部: sysctl・起動ガード・透過ゲートウェイ）と、実VPN（AdGuard）での接続。

## 完了基準

- クリーンなUbuntu 24.04で、`sudo sh install.sh --providers <ID>`（ブートストラップ）の1コマンドだけで、Docker・依存・ホストの設定・ソースの取得・web/api/proxy/ランナーの起動まで完了し、Web UIにベンダーが現れる。
- 同じ操作の再実行が冪等（`.env`の`LAN_IFACE`・ボリュームのログイン情報を保持）で、`--providers`の変更が反映される。
- `--providers`も対話もできない状況で、理由を示して失敗する。
- CIが、ブランチ・タグのブートストラップを生成し、置換漏れの無いこと・取得後のSHA照合を検査する。

## 検証手法

- LXCのクリーンなコンテナで、ブートストラップを`file://`のリポジトリ（REPO_URL）から実行する。GitHub Releaseへの公開・実際の`curl | sh`の経路は、リポジトリへのpushとタグが必要なため、利用者の許可を得て確認する（`git push`は許可があるときのみ）。

## 次フェーズへの申し送り

- （実施後に記載）
