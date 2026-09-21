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
lxc exec vpngw-gw --cwd /opt/vpngwgui -- sh install/detect-lan-interface.sh
lxc exec vpngw-gw --cwd /opt/vpngwgui -- sh install/setup-sysctl.sh
lxc exec vpngw-gw --cwd /opt/vpngwgui -- sh install/setup-boot-guard.sh
bash e2e/lxc/sync.sh                      # ビルド・起動
node e2e/phase3/webgui-login.mjs http://<GW_IP>:8080   # 認証URLを表示 → 人手でブラウザ認証
bash e2e/phase3/gateway-scenarios.sh      # 全シナリオ（A〜H）。個別実行: ... A B
# 実機ゲートウェイの場合は、各e2eコマンドの前に GW_MODE=ssh を付ける。installスクリプトは実機上で
# （/opt/vpngwgui で）`sudo sh install/...` として直接実行する。
```

- 実VPN（シナリオC・D）はAdGuard VPNへのログインが必要。認証情報は検証環境へ複製せず、Web UIのログイン導線で人手認証する。
- ゲートウェイ役のproxyコンテナを再作成すると、待機中の`login`プロセスが終了し認証URLが失効する。ログイン前にビルド・再作成を済ませること。
- FAIL件数が終了コードになる。

## Phase 5の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                       # 転送・ビルド・起動（GW_MODE=lxcなら省略）
GW_MODE=ssh bash e2e/phase5/dashboard-scenarios.sh jp  # 接続国を引数に指定（省略時jp）
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断へ初期化する（設定を書き換えるため、検証専用環境で実行すること）。
- `error-502`はproxyコンテナを一時停止・再開する。終了時に自動で再開する。

## Phase 8の実行手順

Phase 3の環境（実VPNログイン済み）をそのまま使う。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                          # 転送・ビルド・起動
GW_MODE=ssh bash e2e/phase8/locations-scenarios.sh        # 全シナリオ
```

- 開始時に透過ゲートウェイON・Kill Switch ON・VPN切断・お気に入り全解除へ初期化する（検証専用環境で実行すること）。
- 実VPNへ複数回接続・切断する（約1〜2分）。`error-list`はproxyコンテナを一時停止・再開する。
- 検証環境の`settings.json`書き換え（`defaultCountry`残存の互換確認）を含む。
