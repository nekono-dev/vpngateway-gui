# E2E検証（実環境での動作確認）

単体テストではスタブに差し替えている`nft`・`ip`・`sudo`・実VPNベンダーCLI・ブラウザ操作を、実バイナリ・実VPN・実ブラウザで確認するためのスクリプト群。各フェーズの完了判定に用いる（方針は`wbs/README.md`「各フェーズの検証手法」）。

## 構成

| パス | 内容 |
|---|---|
| `lxc/env.sh` | 検証環境の名前・パスの定義 |
| `lxc/setup.sh` | LXCコンテナ2台（ゲートウェイ役・LAN端末役）の作成、Docker導入、LAN端末のGW設定（冪等） |
| `lxc/sync.sh` | リポジトリをゲートウェイ役へ転送し、`docker compose build/up`まで実施（`--no-build`で転送のみ） |
| `lib/playwright.mjs` | グローバルインストールのPlaywright読み込み、ブラウザ起動、アサーション |
| `phase3/webgui-login.mjs` | Web UIの「VPNベンダーへログイン」ボタン→認証URL表示の確認 |
| `phase3/webgui-settings.mjs` | 設定ダイアログで透過ゲートウェイ・Kill Switchを切り替え、保存・再読込後の保持を確認 |
| `phase3/webgui-connection.mjs` | Web UIから接続・切断し、状態表示の切替を確認 |
| `phase5/webgui-dashboard.mjs` | Phase5（Web UI完成）のステップ別Playwright検証（稼働状況表示・トースト・接続ログ・暫定表示・通し操作） |
| `phase5/dashboard-scenarios.sh` | Phase5完了基準を通しで自動検証（実VPNログイン済みのゲートウェイ役が必要。`GW_MODE=ssh`可） |
| `phase8/webgui-locations.mjs` | Phase8（接続先選択UIの刷新）のステップ別Playwright検証（ping順リスト・絞り込み・お気に入り・接続・接続先変更・前回接続・取得失敗） |
| `phase8/locations-scenarios.sh` | Phase8完了基準を通しで自動検証（実VPNログイン済みのゲートウェイ役が必要。`GW_MODE=ssh`可） |
| `phase4/webgui-explicit-proxy.mjs` | Phase4（明示的プロキシ）のステップ別Playwright検証（有効化・CIDR保存・稼働状況表示・不正CIDR・未構成・無効化・crashLoop表示） |
| `phase4/proxy-scenarios.sh` | Phase4完了基準を通しで自動検証（LAN端末役からSOCKS5/HTTPで通信。実VPNログイン済みのゲートウェイ役が必要。`GW_MODE=ssh`可） |
| `phase9/webgui-provider.mjs` | Phase9（プロバイダ抽象化基盤）のステップ別Playwright検証（未ログイン・無料/有料・入力型ログイン・2FA・実行失敗からの学習） |
| `phase9/mock-scenarios.sh` | Phase9完了基準を、モックプロバイダCLI（Proton VPN公式CLIの挙動を模擬）で通しで自動検証（開発ホストのdocker compose。実VPN不要） |
| `phase11/webgui-providers.mjs` | Phase11（Web UIからのベンダー選択）のステップ別Playwright検証（選択部品・切替・接続中の確認と自動切断・ベンダー別状態・利用不可） |
| `phase11/provider-scenarios.sh` | Phase11完了基準を、AdGuard VPN（未ログイン）＋モックProton VPNの2ベンダーで通しで自動検証（開発ホストのdocker compose。ランナーの許可バイナリ・ネットワークコンテナのCLI非同梱も確認） |
| `phase12/add-vendor-scenarios.sh` | Phase12完了基準「ベンダー追加の実証」を自動検証（モックのバンドルを別名で複製して追加するだけで、共通部を変更せずに新ベンダーが現れ・選択でき、外すと消える。開発ホストのdocker compose。実VPN不要） |
| `phase13/install-scenarios.sh` | Phase13完了基準（インストーラ）を、LXCのクリーンなコンテナ（既定ubuntu:24.04。引数でイメージを指定）で自動検証（1コマンドの導入・再実行・ベンダーの追加/削除・ホスト側フック・失敗系。開発ホストのリポジトリから作った裸リポジトリをfile://で取得する。実VPN不要） |
| `phase13/rpi-vm.sh` | Raspberry Pi相当の検証機を、Dockerだけで作って操作する（実物のRaspberry Pi OS Lite arm64のイメージ＋QEMUのarm64エミュレーション。カーネルだけDebian製。`prepare`→`start`→`wait`→`kernel`→`ssh`）。インストーラのarm64・Raspberry Pi OSでの検証用。TCGのため遅い（Dockerイメージのビルドに約1時間） |
| `lib/e2e-vendors.sh` | モックのベンダーバンドル（`e2e/vendors/mockproton/`）を使うE2E用に、有効なベンダーのプロファイルを集めた一時ディレクトリ（`E2E_VENDORS_DIR`）と`VPN_PROVIDERS`、composeの`-f`引数（本体・override・各バンドルのfragment）を用意する |
| `lib/gw.sh` | ゲートウェイ役へのコマンド実行・ファイル転送（`GW_MODE`のlxc/ssh差を吸収） |
| `phase3/gateway-scenarios.sh` | Phase3完了基準のシナリオ（A〜H）を通しで自動検証（G・Hは実機のみ） |

## 前提

- 検証ホストにLXD（`lxc`）・Playwright（`npm i -g playwright`＋Chromium）・Nodeがあること。
- KVMが無い環境でも動くよう、LXD「VM」ではなく`security.nesting=true`のLXCシステムコンテナを使う（`GW_MODE=lxc`、既定）。
- 実機ゲートウェイ（`GW_MODE=ssh`）: SSH鍵認証で`sudo`が使えるホスト（`GW_SSH`、既定`ubuntu@192.168.3.240`）と、開発ホストと同じLANにあること。LAN端末役は開発ホスト上のmacvlan LXCコンテナ（実LANのIPv4/IPv6を持つ。NIC名は`LAN_PARENT`）。資材はscpで転送する。

## Phase 3の実行手順

```sh
bash e2e/lxc/setup.sh                     # 環境構築（初回のみ。GW_IPが表示される）
bash e2e/lxc/sync.sh --no-build           # リポジトリ転送
lxc exec vpngw-gw --cwd /opt/vpngwgui -- sh install/install.sh --providers adguardvpn --no-start   # LAN側IF検出・sysctl・起動ガード・.env（Docker導入済みなら何もしない）
bash e2e/lxc/sync.sh                      # ビルド・起動
node e2e/phase3/webgui-login.mjs http://<GW_IP>:8080   # 認証URLを表示 → 人手でブラウザ認証
bash e2e/phase3/gateway-scenarios.sh      # 全シナリオ（A〜H）。個別実行: ... A B
# 実機ゲートウェイの場合は、各e2eコマンドの前に GW_MODE=ssh を付ける。installスクリプトは実機上で
# （/opt/vpngwgui で）`sudo sh install/...` として直接実行する。
```

- 実VPN（シナリオC・D）はAdGuard VPNへのログインが必要。認証情報は検証環境へ複製せず、Web UIのログイン導線で人手認証する。
- ゲートウェイ役のproxyコンテナを再作成すると、待機中の`login`プロセスが終了し認証URLが失効する。ログイン前にビルド・再作成を済ませること。
- FAIL件数が終了コードになる。

## Phase 4の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。LAN端末役（`CLIENT_NAME`）からゲートウェイ役の`:1080`（SOCKS5）・`:3128`（HTTP）へプロキシ通信する。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                      # 転送・ビルド（3proxyのソースビルドを含む）・起動
GW_MODE=ssh bash e2e/phase4/proxy-scenarios.sh        # 全シナリオ（A〜H・G）。個別実行: ... A C
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断・明示的プロキシ無効へ初期化し、終了時に明示的プロキシ無効・VPN切断へ戻す（検証専用環境で実行すること）。
- 実VPNへ複数回接続・切断する（シナリオD）。シナリオCは3proxyを強制終了し、安定稼働判定（30秒）の待ちを含む（全体で約6分）。シナリオHはproxyコンテナを再起動する。
- LAN端末役自身の直接通信は、透過ゲートウェイ+Kill Switch ON・VPN未接続では遮断されるため、「直接の出口IP」はゲートウェイ役自身の外部IPで代用する。
- 注意: `phase5/dashboard-scenarios.sh`のうち`flow`・`error-422`・`error-502`は、Phase 8で廃止した「接続国」セレクトを前提としており現在は失敗する（Phase 4とは無関係の既存の陳腐化。`initial`・`log`・`ks-off`は通る）。

## Phase 5の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                       # 転送・ビルド・起動（GW_MODE=lxcなら省略）
GW_MODE=ssh bash e2e/phase5/dashboard-scenarios.sh jp  # 接続国を引数に指定（省略時jp）
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断へ初期化する（設定を書き換えるため、検証専用環境で実行すること）。
- `error-502`はproxyコンテナを一時停止・再開する。終了時に自動で再開する。

## Phase 9の実行手順

実VPN・実ネットワークは使わない。開発ホストのdocker composeで、モックプロバイダCLI（`e2e/vendors/mockproton/protonvpn-mock.mjs`。Proton VPN公式CLI 1.0.3のソースに基づく出力・終了コード）を、モックのベンダーバンドル（`e2e/vendors/mockproton/`。ランナー`runner-mockproton`）で実行する専用構成（`docker-compose.e2e-mock.yml`。compose project `vpngwgui-e2e-mock`、Web UIは`http://localhost:18080`）を起動して検証する。

```sh
bash e2e/phase9/mock-scenarios.sh        # 起動（ビルド含む）→ unauth/free/paid/twofa/learned/secrets → 後始末（down -v）
```

- 前提: 開発ホストに`docker compose`プラグイン v2.40以降（`!override`を使う。旧`docker-compose` v2.4.1では動かない。`~/.docker/cli-plugins/docker-compose`へ配置）、Node、Playwright。
- モックのアカウント（パスワードは全て`mock-pass`）: `free@example.com`（無料）／`paid@example.com`（有料）／`free2fa@example.com`（無料・2FAコード`123456`が必要）。
- `learned`は、ログイン状態のキャッシュ（30秒）の期限切れを待つため約31秒待つ（全体で約2分）。
- **実VPN（AdGuard VPN）でのリグレッション**は、従来どおり`GW_MODE=ssh bash e2e/lxc/sync.sh`のあと`GW_MODE=ssh bash e2e/phase8/locations-scenarios.sh`を実行する。

## Phase 11の実行手順

Phase 9と同じ専用構成（`docker-compose.e2e-mock.yml`。compose project `vpngwgui-e2e-mock`、Web UIは`http://localhost:18080`）に、AdGuard VPN（ランナーは同梱するが未ログイン）とモックProton VPNの2ベンダーを有効にして検証する（`make_e2e_vendors_dir adguardvpn mockproton`）。

```sh
bash e2e/phase11/provider-scenarios.sh   # 起動（ビルド含む）→ initial/switch-idle/mock-login-connect/switch-decline/switch-accept/switch-back → ランナー・ネットワークコンテナの構成確認 → unavailable → 後始末
```

- モックのバンドルを使うE2E（Phase 9・11）は、本番と同じ方式（`VPN_PROVIDERS`と、有効なバンドルのcompose fragmentを並べた`-f`）で起動する。APIへ渡すベンダーのディレクトリは、読み取り専用マウントの中へ別の場所のファイルを重ねられないため、スクリプトが`e2e/lib/e2e-vendors.sh`で有効なベンダーのプロファイルだけを集めた一時ディレクトリを作り`E2E_VENDORS_DIR`で渡す。
- **実VPN（AdGuard VPN・ネットワーク分離後）でのリグレッション**は、`GW_MODE=ssh bash e2e/lxc/sync.sh`のあと、`GW_MODE=ssh bash e2e/phase8/locations-scenarios.sh`・`GW_MODE=ssh bash e2e/phase3/gateway-scenarios.sh A B C D E F`・`GW_MODE=ssh bash e2e/phase4/proxy-scenarios.sh`を実行する（Phase 11でVPNデーモンはネットワークコンテナ`proxy`ではなくランナー`runner-adguardvpn`内で動くため、各スクリプトの`docker compose exec`・停止対象を改めた。LAN端末役のmacvlanコンテナは`GW_MODE=ssh bash e2e/lxc/setup.sh`で作る）。

## Phase 8の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                          # 転送・ビルド・起動
GW_MODE=ssh bash e2e/phase8/locations-scenarios.sh        # 全シナリオ
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断・お気に入り全解除へ初期化する（検証専用環境で実行すること）。
- 実VPNへ複数回接続・切断する（約1〜2分）。`error-list`はproxyコンテナを一時停止・再開する。
- 検証環境の`settings.json`書き換え（`defaultCountry`残存の互換確認）を含む。
