# 実装タスク

Phase分けは`wbs/`配下の各`phaseN.md`を参照。本ファイルのタスクは最終形（Phase 2以降）を含めた全体像であり、Phase 1では下記「モックVPN CLI (Phase 1)」節と「内部コマンド受信サーバ」節のみを対象とする。実VPNベンダーCLIへの置換はネットワーク基盤移行より前のPhase 2で行う（`wbs/README.md`「フェーズ分割の考え方」参照）。

## プロジェクトセットアップ

- [x] Node.js/TSプロジェクト初期化
- [x] Dockerfile作成（Phase 1: モックCLI同梱。Phase 2でVPNベンダーCLIバイナリに、Phase 4で3proxy同梱に置換）
- [x] docker-compose設定（Phase 1: 通常のDockerブリッジネットワーク＋`ctl-socket`ボリューム。Phase 2で`cap_add: [NET_ADMIN]`・`devices`を追加、Phase 3で`network_mode: host`に変更）
- [x] API・プロキシ両コンテナの同一UID/GID起動設定

## モックVPN CLI (Phase 1)

- [x] `proxy/mock-cli/adguardvpn-cli-mock.mjs` 作成（`connection -l/-d/-s`応答、エラー注入用`zz`国コード対応）
- [x] Dockerfileへのモックスクリプト同梱・実行権限付与
- [x] 実行可能バイナリ許可リストへのモックスクリプトパス登録

## 内部コマンド受信サーバ（UDS制御チャネル）

- [x] `http` 組み込みモジュールによるUDS listenサーバ実装
- [x] 起動時の残存ソケットファイル `unlink` 処理
- [x] `listen` 後の `chmodSync(0o770)` によるパーミッション制限実装
- [x] 実行可能バイナリ許可リストによる `binary` 照合・拒否処理実装
- [x] `execFile` によるコマンド実行実装（`timeoutMs` 対応、シェル不使用）
- [x] レスポンス（`exitCode`/`stdout`/`stderr`）実装
- [x] リクエスト/レスポンスのランタイムスキーマ検証実装（受信リクエストの最小形状チェックのみ。TypeBox/zod等によるスキーマ定義までは行っていない）
- [x] 実行要求・結果の構造化ログ記録実装

## 実VPNベンダーCLI統合・ログイン代行 (Phase 2)

- [x] 実VPNベンダーCLIバイナリのDockerイメージ同梱（モックCLIスクリプトから置換）
- [x] `cap_add: [NET_ADMIN]`・`devices: [/dev/net/tun]`の付与（`network_mode: host`への移行前だが、コンテナ自身のnetns内で完結するため付与可能。詳細はproxyserver/design.md「Phase 1における縮小構成」参照）
- [x] 実行可能バイナリ許可リストのモックCLIパスから実CLIパスへの置換
- [x] （apiserver側）stdout/stderrパーサーの実CLI用差し替え、`POST /v1/session`（ログイン代行）実装
- [x] 内部コマンド受信サーバへの`completionPattern`対応追加（`runDetachableCommand`、長時間プロセスの早期応答・バックグラウンド継続実行）
- [x] 実機（対象ホスト・実VPN接続）での`connect`動作確認（2026-09-14実施。`adguardvpn-cli connect -l jp -y`でTOKYOへ接続し外部IPが`156.146.34.246`に変化することを確認、`disconnect`で復帰も確認。詳細はwbs/phase2.md「次フェーズへの申し送り」参照）
- [x] Web UI経由（未ログイン→URL表示→ブラウザ認証→状態反映、接続/切断/国変更、504タイムアウト）のE2E確認（2026-09-14実施。詳細はwbs/phase2.md「次フェーズへの申し送り」参照）
- [x] ログイン代行バックグラウンドプロセスが認証完了後もCPUを消費し続ける不具合の修正（stdinを`"pipe"`化、`backgroundTimeoutMs`による安全装置追加。`command-runner.ts`・`command-runner.test.ts`参照）
- [x] ログイン情報永続化がコンテナ再作成で失われる不具合の修正（原因はDockerブリッジネットワークのIPv6非透過。`network_mode: host`への移行をPhase3から前倒し。`docker-compose.yml`・`docker-entrypoint.sh`参照）

## 透過ゲートウェイモード (Phase 3以降)

- [x] IPフォワーディングの起動時チェック・フォールバック設定実装（`proxy/src/network/ip-forward.ts`）
- [x] `nft` コマンドによる専用テーブル（`inet vpngwgui`）管理実装（postrouting/forwardチェーン。`proxy/src/network/ruleset.ts`・`nft-client.ts`）
- [x] VPNトンネルインターフェース名の動的検出処理（`ip route get 1.1.1.1`。`proxy/src/network/tunnel-interface.ts`）
- [x] 再接続・国変更時のルール撤去・再適用処理実装（`/exec`完了直後の即時再評価。`proxy/src/server.ts`・`gateway-controller.ts`）
- [x] コンテナ再起動時のルール整合処理（起動時は撤去せず、最初の`POST /settings`受信時の全撤去→再適用で残骸を掃除する。起動時撤去はKill Switchのリークを招くため廃止した。`GatewayController.applyCurrentState()`。実機検証で発覚）

## Kill Switch (Phase 3以降)

- [x] `killSwitch` ON時の `forward` チェーン `policy drop` 維持・acceptルール管理実装（`proxy/src/network/ruleset.ts`）
- [x] VPN切断検知時のacceptルール即時撤去処理実装（`GatewayController.updateVpnInterface(undefined)`）
- [x] `killSwitch` OFF時のフェイルオープン用フォールバックルール実装（`proxy/src/network/ruleset.ts`）
- [x] ユーザ向け設定変更通知受信によるnftables即時再構成実装（`POST /settings`。`proxy/src/server.ts`・`api/src/proxy-client/proxy-client.ts`の`notifySettings()`）

## 明示的プロキシモード (Phase 4以降)

- [x] 3proxy設定ファイルのテンプレート作成（`proxy/src/explicit-proxy/config-builder.ts`。2026-09-21）
- [x] ユーザ向け設定変更時の3proxy設定ファイル生成処理実装（`POST /settings`→`ExplicitProxyController.applySettings()`。CIDR形式の検証込み。2026-09-21）
- [x] `child_process.spawn` による3proxy起動・監視・異常終了時再起動実装（`proxy/src/explicit-proxy/explicit-proxy-controller.ts`。2026-09-21）
- [x] `explicitProxyEnabled` 切替による起動/停止実装（2026-09-21）
- [x] `explicitProxyAllowedCidrs` の設定反映実装（2026-09-21）
- [x] 3proxyのDockerイメージへの同梱（`proxy/Dockerfile`の`proxy-build`ステージ。ソースからビルド。2026-09-21）
- [x] 内部エンドポイント`GET /status`への`explicitProxy`追加（2026-09-21）

## 稼働状況取得 (Phase 5)

- [x] `GatewayController`から現在状態を読み出すアクセサ追加（`getStatus()`。2026-09-21）
- [x] 内部エンドポイント`GET /status`実装（`proxy/src/server.ts`。2026-09-21）
- [x] `GET /status`の単体テスト（`gateway-controller.test.ts`の`getStatus`。エンドポイント自体は実機E2Eで確認）

## VPN接続状態監視

- [x] 接続状態・トンネル経路消失の監視処理実装（10秒間隔ポーリング。`proxy/src/network/connection-monitor.ts`）
- [x] 切断検知トリガーとKill Switch/透過ゲートウェイ連携実装（`GatewayController`経由）

## excludedDomains（split-tunnel除外）対応

- [ ] ドメイン単位除外のDNS解決・ルーティング反映方式の詳細設計
- [ ] 上記方式の実装（3proxy側／透過ゲートウェイ側それぞれ）

## インストールスクリプト (Phase 3以降)

- [x] `/etc/sysctl.d/99-vpngwgui.conf` 作成・`sysctl --system` 実行処理実装（`install/setup-sysctl.sh`）
- [x] LANインターフェース名検出・設定ファイル（`.env`の`LAN_IFACE`）書き出し処理実装（`install/detect-lan-interface.sh`）
- [x] 起動時フェイルクローズ用ガードのsystemdユニット作成処理実装（`install/setup-boot-guard.sh`。ホスト再起動中のリーク対策。実機検証で発覚）
- [x] ホスト→プロキシコンテナ経由の外部通信設定処理実装（`docker-compose.yml`の`LAN_IFACE: ${LAN_IFACE:-}`によるvariable substitution）

## 障害対応

- [x] 3proxyクラッシュループ時の指数バックオフ実装（1秒→上限60秒。連続3回で`crashLoop`報告。2026-09-21）
- [x] APIサーバへのエラー状態通知実装（`GET /status`の`explicitProxy.state=crashLoop`をAPIが中継するpull方式。push経路は新設しない。理由はproxyserver/design.md「`GET /status`」。2026-09-21）
- [x] コンテナ再起動時のnftables残骸確認・撤去処理実装（上記「透過ゲートウェイモード」参照。最初の`POST /settings`受信時に全撤去→再適用）

## テスト

- [ ] nftablesルール適用/撤去の動作確認（実機・実nftableskernelでの検証が必要。ルール文字列組み立て・撤去→再適用の調停ロジック自体は`proxy/src/network/ruleset.test.ts`・`gateway-controller.test.ts`で単体テスト済みだが、実nftバイナリ・実カーネルでの動作は未検証。wbs/phase3.md「次フェーズへの申し送り」参照）
- [ ] Kill Switch（ON/OFF双方）の動作確認（同上、ルール生成ロジックの単体テストのみ実施済み。実機でのLAN機器からの疎通確認は未実施）
- [ ] UDS受信サーバの単体テスト（許可リスト外バイナリの拒否含む）
- [x] 明示的プロキシのE2E疎通確認（`e2e/phase4/proxy-scenarios.sh`。許可/拒否CIDR・有効無効・強制終了・crashLoop・VPN接続との独立・Web UI・コンテナ再起動を実機で確認。2026-09-21）
- [ ] 透過ゲートウェイと明示的プロキシを同時に有効にした状態での長時間・高負荷の安定性確認（未実施）

## プロバイダ抽象化・複数プロバイダ対応（Phase 9・10）

- [x] （Phase 9）`POST /exec`の`stdin`対応（`runCommand`・入力検証・4096バイト上限・ログへ内容を出さない）と単体テスト
- [x] （Phase 9）`EXTRA_ALLOWED_BINARIES`（E2E専用の追加許可バイナリ）と単体テスト
- [x] （Phase 9）モックプロバイダCLI（`proxy/mock-cli/protonvpn-mock.mjs`。公式CLI 1.0.3のソースに基づく出力・終了コードで、無料/有料・ログイン状態を模擬）と`docker-compose.e2e-mock.yml`
- [x] （Phase 9）`proxy/Dockerfile`を`proxy/Dockerfile.adguardvpn`へ改名し、`docker-compose.yml`を`VPN_PROVIDER`で切り替え可能にする
- [ ] （Phase 10）Proton VPN向けイメージのPoC（合否基準はdesign.md「Proton VPN向けproxyイメージ」）
- [ ] （Phase 10）`proxy/Dockerfile.protonvpn`・エントリポイント・`docker-compose.protonvpn.yml`・許可リストへの`/usr/bin/protonvpn`追加
- [ ] （Phase 10）実機検証（人手ログイン。透過ゲートウェイ・Kill Switch・コンテナ再起動後のログイン保持）

## ネットワークコンテナとランナーの分離（Phase 11）

- [ ] `proxy/src/runner.ts`（ランナー: `POST /exec`・`GET /health`。許可リストは`RUNNER_ALLOWED_BINARY`の1つのみ）と、UDS待受・JSON入出力の共有モジュール化
- [ ] `server.ts`（ネットワーク）から`/exec`・許可リスト・コマンド実行を分離し、`POST /connection-checks`を追加（`/settings`・`/status`は不変）
- [ ] `EXTRA_ALLOWED_BINARIES`の廃止と`RUNNER_ALLOWED_BINARY`への置換（`allowlist.ts`・テスト）
- [ ] `proxy/Dockerfile`（ネットワーク。CLIなし）・`Dockerfile.runner-adguardvpn`（従来のAdGuard用から分離）・`Dockerfile.runner-mock`（E2E専用）
- [ ] `docker-compose.yml`の再構成（`proxy`＋`runner-*`、`profiles`、`ENABLED_PROVIDERS`、ソケット名、ボリューム）、`install/select-providers.sh`、`docker-compose.e2e-mock.yml`の改修、`docker-compose.protonvpn.yml`・`VPN_PROVIDER`の廃止
- [ ] 実VPN（AdGuard）で、ネットワークコンテナ分離後も透過ゲートウェイ・Kill Switch・明示的プロキシが従来どおり動くことの確認（`e2e/phase3`・`phase4`のリグレッション）

# 将来課題

- IPv6対応（現行設計はIPv4のNAT/FORWARDのみを前提としている）。
- 複数VPNベンダー・複数トンネルの同時稼働可否。
- `excludedDomains` のDNS TTL追従の詳細実装。
