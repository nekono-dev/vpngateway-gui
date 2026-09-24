# 実装タスク

（Phase 8で、ベンダーCLIを実行するランナーコンテナを`../runner/`（要件・設計・タスク）へ切り出した。モックCLI・内部コマンド受信サーバ（`POST /exec`）・実VPNベンダーCLI統合・プロバイダ抽象化のタスクは`../runner/tasks.md`へ移動した。）

## プロジェクトセットアップ

- [x] Node.js/TSプロジェクト初期化
- [x] Dockerfile作成（Phase 1: モックCLI同梱。Phase 2でVPNベンダーCLIバイナリに、Phase 6で3proxy同梱に置換）
- [x] docker-compose設定（Phase 1: 通常のDockerブリッジネットワーク＋`ctl-socket`ボリューム。Phase 2で`cap_add: [NET_ADMIN]`・`devices`を追加、Phase 3で`network_mode: host`に変更）
- [x] API・プロキシ両コンテナの同一UID/GID起動設定

## 透過ゲートウェイモード (Phase 3以降)

- [x] IPフォワーディングの起動時チェック・フォールバック設定実装（`proxy/src/network/ip-forward.ts`）
- [x] `nft` コマンドによる専用テーブル（`inet vpngwgui`）管理実装（postrouting/forwardチェーン。`proxy/src/network/ruleset.ts`・`nft-client.ts`）
- [x] VPNトンネルインターフェース名の動的検出処理（`ip route get 1.1.1.1`。`proxy/src/network/tunnel-interface.ts`）
- [x] 再接続・国変更時のルール撤去・再適用処理実装（Phase 9までは`/exec`完了直後の即時再評価、Phase 8以降はAPIからの`POST /connection-checks`。`proxy/src/server.ts`・`gateway-controller.ts`）
- [x] コンテナ再起動時のルール整合処理（起動時は撤去せず、最初の`POST /settings`受信時の全撤去→再適用で残骸を掃除する。起動時撤去はKill Switchのリークを招くため廃止した。`GatewayController.applyCurrentState()`。実機検証で発覚）

## Kill Switch (Phase 3以降)

- [x] `killSwitch` ON時の `forward` チェーン `policy drop` 維持・acceptルール管理実装（`proxy/src/network/ruleset.ts`）
- [x] VPN切断検知時のacceptルール即時撤去処理実装（`GatewayController.updateVpnInterface(undefined)`）
- [x] `killSwitch` OFF時のフェイルオープン用フォールバックルール実装（`proxy/src/network/ruleset.ts`）
- [x] ユーザ向け設定変更通知受信によるnftables即時再構成実装（`POST /settings`。`proxy/src/server.ts`・`api/src/proxy-client/proxy-client.ts`の`notifySettings()`）

## 明示的プロキシモード (Phase 6以降)

- [x] 3proxy設定ファイルのテンプレート作成（`proxy/src/explicit-proxy/config-builder.ts`。2026-09-21）
- [x] ユーザ向け設定変更時の3proxy設定ファイル生成処理実装（`POST /settings`→`ExplicitProxyController.applySettings()`。CIDR形式の検証込み。2026-09-21）
- [x] `child_process.spawn` による3proxy起動・監視・異常終了時再起動実装（`proxy/src/explicit-proxy/explicit-proxy-controller.ts`。2026-09-21）
- [x] `explicitProxyEnabled` 切替による起動/停止実装（2026-09-21）
- [x] `explicitProxyAllowedCidrs` の設定反映実装（2026-09-21）
- [x] 3proxyのDockerイメージへの同梱（`proxy/Dockerfile`の`proxy-build`ステージ。ソースからビルド。2026-09-21）
- [x] 内部エンドポイント`GET /status`への`explicitProxy`追加（2026-09-21）

## 稼働状況取得 (Phase 4)

- [x] `GatewayController`から現在状態を読み出すアクセサ追加（`getStatus()`。2026-09-21）
- [x] 内部エンドポイント`GET /status`実装（`proxy/src/server.ts`。2026-09-21）
- [x] `GET /status`の単体テスト（`gateway-controller.test.ts`の`getStatus`。エンドポイント自体は実機E2Eで確認）

## VPN接続状態監視

- [x] 接続状態・トンネル経路消失の監視処理実装（10秒間隔ポーリング。`proxy/src/network/connection-monitor.ts`）
- [x] 切断検知トリガーとKill Switch/透過ゲートウェイ連携実装（`GatewayController`経由）

## ドメイン迂回とDNS中継（Phase 14）

設計は`design.md`「ドメイン迂回とDNS中継」。実装後に、主要タスクをまとめて実機検証する。

### Step 1: 実装

- [ ] 設定の形状検証の拡張（`server.ts`の`handleSettings`。`excludedDomains`・`dns*`）
- [ ] 迂回リストの照合（完全一致・`*.`ワイルドカード。両者は独立で、片方の登録が他方を含意しないこと）の実装と単体テスト（`proxy/src/dns-relay/`）
- [ ] DNSメッセージの解析・応答IPとTTLの抽出（UDP・TCP）
- [ ] DoH上流への転送（ClientID付与、`dnsUpstreamCaPem`による検証、タイムアウト）
- [ ] ClientIDの生成（`/proc/net/arp`からのMAC取得・キャッシュ・IPへのフォールバック）
- [ ] 上流障害時の挙動（フェイルクローズ／`dnsFallbackServers`へのフォールバック）と、上流の疎通状態の管理
- [ ] `DnsRelayController`（設定の反映・再構成・状態・監査ログ）
- [ ] nft set（`bypass4`）・マーク付けチェーン・forward許可・マスカレードの追加（`ruleset.ts`）と、再構成時のset要素の引き継ぎ
- [ ] `ip rule`／テーブル100の管理（デフォルトゲートウェイの検出・追従）
- [ ] 明示的プロキシ: 3proxyの`nserver`をリゾルバへ向ける設定生成、`output`チェーンのマーク付け
- [ ] 53番リダイレクト（nat prerouting、除外CIDR）
- [ ] `GET /net/status`への`dnsRelay`追加
- [ ] インストーラ: `send_redirects=0`のsysctl設定
- [ ] 単体テスト（ruleset・config-builder・DNS中継の各モジュール）

### Step 2: 実機検証（検証サーバ。テスト用AdGuard Home導入後）

- [ ] モックVPN: 迂回ドメインへの通信が実回線から出て、非対象はトンネルを経由すること（透過ゲートウェイ）
- [ ] モックVPN: 同上（明示的プロキシ）
- [ ] TTLの短いドメインでIP変化に追従し、期限後は迂回対象から外れること
- [ ] 完全一致と`*.`ワイルドカードの照合（`example.com`のみ登録時にサブドメインが迂回されないこと、`*.example.com`のみ登録時に`example.com`が迂回されないこと）
- [ ] AdGuard Homeの履歴に、クライアントがClientIDで区別されて記録されること
- [ ] 上流停止時: フェイルクローズ／フォールバックの両方
- [ ] 53番リダイレクト有効時、手動DNS指定の端末の問い合わせが中継されること
- [ ] VPN未接続・Kill Switch ON時に、名前解決と迂回対象の疎通が意図どおりであること
- [ ] 実VPN（Web UIから利用者が手動ログイン）: 出口IPの差で迂回を確認
- [ ] 検証で確定した仕様（CNAME・set期限の猶予・ゲートウェイ検出等）の`design.md`への反映

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

- [x] nftablesルール適用/撤去の動作確認（ルール文字列組み立て・撤去→再適用の調停ロジックは`proxy/src/network/ruleset.test.ts`・`gateway-controller.test.ts`で単体テスト済み。実nftバイナリ・実カーネルでの動作は、LXC検証環境と実機（Ubuntu 24.04・単一NIC・実LAN、2026-09-21）で確認。実機シナリオA〜Hの93項目がFAIL 0）
- [x] Kill Switch（ON/OFF双方）の動作確認（実機・LAN端末からの疎通確認。切断・瞬断・上流断・ホスト再起動のいずれでもフェイルクローズ、OFF時はフェイルオープンを確認。2026-09-21）
- [x] UDS受信サーバの単体テスト（許可リスト外バイナリの拒否含む。Phase 8のランナー分離後は`../runner/tasks.md`「ランナーの分離」の`allowlist.test.ts`・`exec/exec-handler.test.ts`）
- [x] 明示的プロキシのE2E疎通確認（`e2e/phase6/proxy-scenarios.sh`。許可/拒否CIDR・有効無効・強制終了・crashLoop・VPN接続との独立・Web UI・コンテナ再起動を実機で確認。2026-09-21）
- [ ] 透過ゲートウェイと明示的プロキシを同時に有効にした状態での長時間・高負荷の安定性確認（未実施）

## ネットワークコンテナとランナーの分離（Phase 8）

ランナー側のタスクは`../runner/tasks.md`。

- [x] `server.ts`（ネットワーク）から`/exec`・許可リスト・コマンド実行を分離し、`POST /connection-checks`を追加（`/settings`・`/status`は不変）
- [x] `proxy/Dockerfile`（ネットワーク。CLIなし）のビルド確認、`docker-compose.yml`の`proxy`サービスの再構成（`/dev/net/tun`の除去・ソケット名`net.sock`）
- [x] `install/select-providers.sh`（`VPN_PROVIDERS`・`COMPOSE_PROFILES`の書き出し）の動作確認
- [x] 実VPN（AdGuard）で、ネットワークコンテナ分離後も透過ゲートウェイ・Kill Switch・明示的プロキシが従来どおり動くことの確認（`e2e/phase3`・`phase6`のリグレッション）

## ベンダー非依存化・インストーラ（Phase 10・11）

- [x] （Phase 10）ネットワークコンテナのコード・コメントからベンダー固有名を除去（存在しない`proxy/Dockerfile.adguardvpn`への参照の修正を含む）
- [x] （Phase 11）`install/install.sh`（本体。`setup-sysctl.sh`・`detect-lan-interface.sh`・`setup-boot-guard.sh`・`select-providers.sh`の統合。従来の4本は削除）
- [x] （Phase 11）`install/bootstrap.sh`（頒布物の雛形）・`install/build-bootstrap.sh`
- [x] （Phase 11）`.github/workflows/installer.yml`（検査・ブランチのartifact・タグのRelease）。GitHub Actionsでの実行を確認済み: pushで`installer-main`のartifactを生成、タグ`v0.1.0`のpushでGitHub Releaseに`install.sh`・`install.sh.sha256`を添付し、認証なしの`curl -fsSL .../releases/latest/download/install.sh | sh`で導入できることを確認
- [x] （Phase 11）クリーンな環境（LXC、Ubuntu 24.04・Debian 12）での検証: 導入・ベンダーの追加/削除・再実行・`install-host.sh`のフック（26項目FAIL 0）
- [x] （Phase 11）Raspberry Pi OS Lite arm64（trixie。実イメージ、カーネルのみQEMU向け汎用arm64）での1コマンド導入・起動・再起動を確認
- [x] （Phase 11）利用者が用意した実機arm64ホスト（Debian 13、単一NIC・実LAN）で、Kill Switchの実通信（フェイルクローズ・フェイルオープン、19項目FAIL 0）と実VPN（AdGuard VPN）接続シナリオ（24項目FAIL 0）を確認。検証中にDocker Engine 28以降のFORWARD既定ポリシー変更でフェイルオープンが機能しない不具合を発見し、`daemon.json`の`ip-forward-no-drop`設定で修正（`specs/design.md`「本体インストーラ」参照）

## デプロイメント構成の分離（Phase 25）

- [x] ゲートウェイ制御チャネル: `proxy`にmTLS TCPリスナー（`GATEWAY_PORT`）を追加し、`/net/*`（自分自身）・`/runners/<ID>/*`（UDS転送）のパスルーティングを実装
- [x] compose分割（`compose/gateway.yml`・`compose/web.yml`・`compose/api.yml`）
- [x] インストーラの証明書生成・配布（`install/install.sh`の`generate_role_pki`・`distribute_pki_local`・`distribute_pki_remote`。別スクリプトへの分離はせず`install.sh`内の関数として実装）
- [x] 単体・結合テスト（証明書検証失敗時の拒否: クライアント証明書無し・別CA署名のいずれも接続確立せず正しい証明書のみ確立することを実TLSサーバ・クライアントで確認。パスルーティングの単体テスト）
- [x] 実機検証: 単一ホスト構成で`proxy`が`gatewayPort: 8443`でmTLS TCPをlistenし、`GET /v1/providers`・`GET /v1/connection/gateway`・設定変更が正しく中継されることをcurlで確認。クライアント証明書無し接続がTLSアラートで拒否されることを確認。3台に分離した構成でも同様に到達性を確認
- [ ] 透過ゲートウェイ・明示的プロキシの実VPN接続を伴うシナリオ（gateway-scenariosのC以降）の、mTLS化後・3台分離構成での網羅的な再実行は未実施

# 将来課題

- IPv6対応（現行設計はIPv4のNAT/FORWARDのみを前提としている）。
- 複数VPNベンダー・複数トンネルの同時稼働可否。
- `excludedDomains` のDNS TTL追従の詳細実装。
- 証明書の失効・自動ローテーション、外部認証局（Let's Encrypt等）との連携。
- 明示的プロキシへのKill Switch適用（現状はKill Switchが`forward`チェーンのみを対象とするため、VPN未接続時は`killSwitch=true`でも明示的プロキシ経由の通信が実回線から直接出る。既知の制約、`design.md`「Kill Switch」参照。対処案: 3proxy専用UIDでの起動と、そのUIDに対する`output`チェーンでのVPN未接続時dropの追加）。
- 明示的プロキシのユーザー名・パスワード認証（現状は送信元IPのCIDRのみ）。
- 設定変更時の3proxy再起動（SIGTERMから終了まで約10秒応答が途切れる）の無停止化（SIGUSR1による設定再読み込みの検討）。