# E2E検証（実環境での動作確認）

単体テストではスタブに差し替えている`nft`・`ip`・`sudo`・実VPNベンダーCLI・ブラウザ操作を、実バイナリ・実VPN・実ブラウザで確認するためのスクリプト群。各機能の完了判定に用いる（AGENTS.md「実機検証のタイミング」）。

## 構成

| パス | 内容 |
|---|---|
| `lxc/env.sh` | 検証環境の名前・パスの定義 |
| `lxc/setup.sh` | LXCコンテナ2台（ゲートウェイ役・LAN端末役）の作成、Docker導入、LAN端末のGW設定（冪等） |
| `lxc/sync.sh` | リポジトリをゲートウェイ役へ転送し、`docker compose build/up`まで実施（`--no-build`で転送のみ） |
| `lib/playwright.mjs` | グローバルインストールのPlaywright読み込み、ブラウザ起動、アサーション。Phase25以降は`launch()`がE2E共通アカウント（`E2E_USERNAME`/`E2E_PASSWORD`）で初期設定・ログインを自動的に済ませる |
| `lib/api-auth.sh` | Phase25以降、シェルスクリプトが直接curlでAPIを呼ぶ際の認証。`e2e_api_login`（ローカルからのcurl用）・`gw_api_login`（`gw`経由でゲートウェイ役自身の上から叩く場合用）・`reset_operator_account`（検証後、Web UI利用者アカウントを削除しインストール直後の未設定状態へ戻す） |
| `phase3/webgui-login.mjs` | Web UIの「VPNベンダーへログイン」ボタン→認証URL表示の確認 |
| `phase3/webgui-settings.mjs` | 設定ダイアログで透過ゲートウェイ・Kill Switchを切り替え、保存・再読込後の保持を確認 |
| `phase3/webgui-connection.mjs` | Web UIから接続・切断し、状態表示の切替を確認 |
| `phase4/webgui-dashboard.mjs` | Phase4（Web UI完成）のステップ別Playwright検証（稼働状況表示・トースト・接続ログ・暫定表示・通し操作） |
| `phase4/dashboard-scenarios.sh` | Phase4完了基準を通しで自動検証（実VPNログイン済みのゲートウェイ役が必要。`GW_MODE=ssh`可） |
| `phase5/webgui-locations.mjs` | Phase5（接続先選択UIの刷新）のステップ別Playwright検証（ping順リスト・絞り込み・お気に入り・接続・接続先変更・前回接続・取得失敗） |
| `phase5/locations-scenarios.sh` | Phase5完了基準を通しで自動検証（実VPNログイン済みのゲートウェイ役が必要。`GW_MODE=ssh`可） |
| `phase6/webgui-explicit-proxy.mjs` | Phase6（明示的プロキシ）のステップ別Playwright検証（有効化・CIDR保存・稼働状況表示・不正CIDR・未構成・無効化・crashLoop表示） |
| `phase6/proxy-scenarios.sh` | Phase6完了基準を通しで自動検証（LAN端末役からSOCKS5/HTTPで通信。実VPNログイン済みのゲートウェイ役が必要。`GW_MODE=ssh`可） |
| `phase7/webgui-provider.mjs` | Phase7（プロバイダ抽象化基盤）のステップ別Playwright検証（未ログイン・無料/有料・入力型ログイン・2FA・実行失敗からの学習） |
| `phase7/mock-scenarios.sh` | Phase7完了基準を、モックプロバイダCLI（Proton VPN公式CLIの挙動を模擬）で通しで自動検証（開発ホストのdocker compose。実VPN不要） |
| `phase8/webgui-providers.mjs` | Phase8（Web UIからのベンダー選択）のステップ別Playwright検証（選択部品・切替・接続中の確認と自動切断・ベンダー別状態・利用不可） |
| `phase8/provider-scenarios.sh` | Phase8完了基準を、AdGuard VPN（未ログイン）＋モックProton VPNの2ベンダーで通しで自動検証（開発ホストのdocker compose。ランナーの許可バイナリ・ネットワークコンテナのCLI非同梱も確認） |
| `phase10/add-vendor-scenarios.sh` | Phase10完了基準「ベンダー追加の実証」を自動検証（モックのバンドルを別名で複製して追加するだけで、共通部を変更せずに新ベンダーが現れ・選択でき、外すと消える。開発ホストのdocker compose。実VPN不要） |
| `phase11/install-scenarios.sh` | Phase11完了基準（インストーラ）を、LXCのクリーンなコンテナ（既定ubuntu:24.04。引数でイメージを指定）で自動検証（1コマンドの導入・再実行・ベンダーの追加/削除・ホスト側フック・失敗系。開発ホストのリポジトリから作った裸リポジトリをfile://で取得する。実VPN不要） |
| `phase11/rpi-vm.sh` | Raspberry Pi相当の検証機を、Dockerだけで作って操作する（実物のRaspberry Pi OS Lite arm64のイメージ＋QEMUのarm64エミュレーション。カーネルだけDebian製。`prepare`→`start`→`wait`→`kernel`→`ssh`）。インストーラのarm64・Raspberry Pi OSでの検証用。TCGのため遅い（Dockerイメージのビルドに約1時間） |
| `phase16/webgui-phase16.mjs` | Phase16（起動時の接続復元・接続/切断ボタンの配置改善・参考一覧での現在の接続先表示）のうちWeb UI側のPlaywright検証（接続/切断ボタンの配置・配色、接続⇄切断での表示の切替、参考一覧での現在の接続先バッジ・ping列の出し分け・選択無効化）。開始時の接続状態（接続中/切断中）に応じて検証内容を選ぶため、実VPNの状態を問わず実行できる。起動時の接続復元そのもの（APIコンテナ再起動を伴う）は手順化されたスクリプトが無く、`specs/apiserver/tasks.md`「起動時の接続状態の復元」に記載の手順で手動で確認した |
| `phase20/uninstall-scenarios.sh` | Phase20完了基準（アンインストールの頒布URL対応・取得先ディレクトリの削除）を、LXCのクリーンなコンテナで自動検証（`--uninstall`をブートストラップの標準入力パイプで実行し、取得先ディレクトリ・docker composeスタック・sysctl設定・起動時ガードの後始末、再導入できることを確認。`phase11/install-scenarios.sh`と同じくfile://で取得する。実VPN不要） |
| `phase21/webgui-phase21.mjs` | Phase21（ダッシュボードのカード構成・レイアウトの整理）のWeb UI側のPlaywright検証（ページ全体がビューポートに収まること。特に「接続できる国（参考）」一覧表示時の回帰確認、未ログインのベンダーへ切り替えたときに「ログインしてください」が重複表示されないこと）。ログイン済み・未ログインの両方のベンダーが用意された環境（検証環境のAdGuard VPN・Proton VPN）で実行する |
| `lib/e2e-vendors.sh` | モックのベンダーバンドル（`e2e/vendors/mockproton/`）を使うE2E用に、有効なベンダーのプロファイルを集めた一時ディレクトリ（`E2E_VENDORS_DIR`）と`VPN_PROVIDERS`、composeの`-f`引数（本体・override・各バンドルのfragment）を用意する |
| `lib/gw.sh` | ゲートウェイ役へのコマンド実行・ファイル転送（`GW_MODE`のlxc/ssh差を吸収） |
| `phase3/gateway-scenarios.sh` | Phase3完了基準のシナリオ（A〜H）を通しで自動検証（G・Hは実機のみ） |

## 前提

- 検証ホストにLXD（`lxc`）・Playwright（`npm i -g playwright`＋Chromium）・Nodeがあること。
- KVMが無い環境でも動くよう、LXD「VM」ではなく`security.nesting=true`のLXCシステムコンテナを使う（`GW_MODE=lxc`、既定）。
- 実機ゲートウェイ（`GW_MODE=ssh`）: SSH鍵認証で`sudo`が使えるホスト（`GW_SSH`、既定`ubuntu@192.168.3.240`）と、開発ホストと同じLANにあること。LAN端末役は開発ホスト上のmacvlan LXCコンテナ（実LANのIPv4/IPv6を持つ。NIC名は`LAN_PARENT`）。資材はscpで転送する。

## Web UI利用者認証（Phase25以降）への対応

APIサーバが全`/v1/*`にセッションCookie認証を要求するため、各E2Eスクリプトは以下のいずれかでこれを通過する。

- ブラウザ操作（`lib/playwright.mjs`の`launch()`）: E2E共通アカウント（`e2e-admin`）で自動的に初期設定・ログインを行う。個別スクリプトの変更は不要。
- シェルから直接curlでAPIを叩くスクリプト（`*-scenarios.sh`）: `lib/api-auth.sh`の`e2e_api_login`（ローカル実行）または`gw_api_login`（`gw`経由でゲートウェイ役自身の上から）でログインし、Cookieを付けて呼ぶ。

検証環境（実機ゲートウェイ・LXCゲートウェイいずれも、`docker compose down -v`でvolumeごと消える一時構成を除く）を使うスクリプトは、終了時に`reset_operator_account`（`lib/api-auth.sh`）を呼び、Web UI利用者アカウントを削除して**インストール直後の未設定状態**（初期設定画面が出る状態）へ戻す。新しいE2Eスクリプトを永続環境（`GW_MODE=ssh`/`lxc`の検証機）向けに追加する場合は、同様に終了時のクリーンアップを組み込むこと。

## Phase 3の実行手順

```sh
bash e2e/lxc/setup.sh                     # 環境構築（初回のみ。GW_IPが表示される）
bash e2e/lxc/sync.sh --no-build           # リポジトリ転送
lxc exec vpngw-gw --cwd /opt/vpngwgui -- sh install/install.sh --providers adguardvpn --no-start   # LAN側IF検出・sysctl・起動ガード・.env（Docker導入済みなら何もしない）
bash e2e/lxc/sync.sh                      # ビルド・起動
node e2e/phase3/webgui-login.mjs https://<GW_IP>:8080   # 認証URLを表示 → 人手でブラウザ認証
bash e2e/phase3/gateway-scenarios.sh      # 全シナリオ（A〜H）。個別実行: ... A B
# 実機ゲートウェイの場合は、各e2eコマンドの前に GW_MODE=ssh を付ける。installスクリプトは実機上で
# （/opt/vpngwgui で）`sudo sh install/...` として直接実行する。
```

- 実VPN（シナリオC・D）はAdGuard VPNへのログインが必要。認証情報は検証環境へ複製せず、Web UIのログイン導線で人手認証する。
- ゲートウェイ役のproxyコンテナを再作成すると、待機中の`login`プロセスが終了し認証URLが失効する。ログイン前にビルド・再作成を済ませること。
- FAIL件数が終了コードになる。

## Phase 6の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。LAN端末役（`CLIENT_NAME`）からゲートウェイ役の`:1080`（SOCKS5）・`:3128`（HTTP）へプロキシ通信する。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                      # 転送・ビルド（3proxyのソースビルドを含む）・起動
GW_MODE=ssh bash e2e/phase6/proxy-scenarios.sh        # 全シナリオ（A〜H・G）。個別実行: ... A C
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断・明示的プロキシ無効へ初期化し、終了時に明示的プロキシ無効・VPN切断へ戻す（検証専用環境で実行すること）。
- 実VPNへ複数回接続・切断する（シナリオD）。シナリオCは3proxyを強制終了し、安定稼働判定（30秒）の待ちを含む（全体で約6分）。シナリオHはproxyコンテナを再起動する。
- LAN端末役自身の直接通信は、透過ゲートウェイ+Kill Switch ON・VPN未接続では遮断されるため、「直接の出口IP」はゲートウェイ役自身の外部IPで代用する。
- 注意: `phase4/dashboard-scenarios.sh`のうち`flow`・`error-422`・`error-502`は、Phase 5で廃止した「接続国」セレクトを前提としており現在は失敗する（Phase 6とは無関係の既存の陳腐化。`initial`・`log`・`ks-off`は通る）。

## Phase 4の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                       # 転送・ビルド・起動（GW_MODE=lxcなら省略）
GW_MODE=ssh bash e2e/phase4/dashboard-scenarios.sh jp  # 接続国を引数に指定（省略時jp）
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断へ初期化する（設定を書き換えるため、検証専用環境で実行すること）。
- `error-502`はproxyコンテナを一時停止・再開する。終了時に自動で再開する。

## Phase 7の実行手順

実VPN・実ネットワークは使わない。開発ホストのdocker composeで、モックプロバイダCLI（`e2e/vendors/mockproton/protonvpn-mock.mjs`。Proton VPN公式CLI 1.0.3のソースに基づく出力・終了コード）を、モックのベンダーバンドル（`e2e/vendors/mockproton/`。ランナー`runner-mockproton`）で実行する専用構成（`docker-compose.e2e-mock.yml`。compose project `vpngwgui-e2e-mock`、Web UIは`https://localhost:18080`（自己署名証明書））を起動して検証する。

```sh
bash e2e/phase7/mock-scenarios.sh        # 起動（ビルド含む）→ unauth/free/paid/twofa/learned/secrets → 後始末（down -v）
```

- 前提: 開発ホストに`docker compose`プラグイン v2.40以降（`!override`を使う。旧`docker-compose` v2.4.1では動かない。`~/.docker/cli-plugins/docker-compose`へ配置）、Node、Playwright。
- モックのアカウント（パスワードは全て`mock-pass`）: `free@example.com`（無料）／`paid@example.com`（有料）／`free2fa@example.com`（無料・2FAコード`123456`が必要）。
- `learned`は、ログイン状態のキャッシュ（30秒）の期限切れを待つため約31秒待つ（全体で約2分）。
- **実VPN（AdGuard VPN）でのリグレッション**は、従来どおり`GW_MODE=ssh bash e2e/lxc/sync.sh`のあと`GW_MODE=ssh bash e2e/phase5/locations-scenarios.sh`を実行する。

## Phase 8の実行手順

Phase 7と同じ専用構成（`docker-compose.e2e-mock.yml`。compose project `vpngwgui-e2e-mock`、Web UIは`https://localhost:18080`（自己署名証明書））に、AdGuard VPN（ランナーは同梱するが未ログイン）とモックProton VPNの2ベンダーを有効にして検証する（`make_e2e_vendors_dir adguardvpn mockproton`）。

```sh
bash e2e/phase8/provider-scenarios.sh   # 起動（ビルド含む）→ initial/switch-idle/mock-login-connect/switch-decline/switch-accept/switch-back → ランナー・ネットワークコンテナの構成確認 → unavailable → 後始末
```

- モックのバンドルを使うE2E（Phase 7・8）は、本番と同じ方式（`VPN_PROVIDERS`と、有効なバンドルのcompose fragmentを並べた`-f`）で起動する。APIへ渡すベンダーのディレクトリは、読み取り専用マウントの中へ別の場所のファイルを重ねられないため、スクリプトが`e2e/lib/e2e-vendors.sh`で有効なベンダーのプロファイルだけを集めた一時ディレクトリを作り`E2E_VENDORS_DIR`で渡す。
- **実VPN（AdGuard VPN・ネットワーク分離後）でのリグレッション**は、`GW_MODE=ssh bash e2e/lxc/sync.sh`のあと、`GW_MODE=ssh bash e2e/phase5/locations-scenarios.sh`・`GW_MODE=ssh bash e2e/phase3/gateway-scenarios.sh A B C D E F`・`GW_MODE=ssh bash e2e/phase6/proxy-scenarios.sh`を実行する（Phase 8でVPNデーモンはネットワークコンテナ`proxy`ではなくランナー`runner-adguardvpn`内で動くため、各スクリプトの`docker compose exec`・停止対象を改めた。LAN端末役のmacvlanコンテナは`GW_MODE=ssh bash e2e/lxc/setup.sh`で作る）。

## Phase 5の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                          # 転送・ビルド・起動
GW_MODE=ssh bash e2e/phase5/locations-scenarios.sh        # 全シナリオ
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断・お気に入り全解除へ初期化する（検証専用環境で実行すること）。
- 実VPNへ複数回接続・切断する（約1〜2分）。`error-list`はproxyコンテナを一時停止・再開する。
- 検証環境の`settings.json`書き換え（`defaultCountry`残存の互換確認）を含む。
