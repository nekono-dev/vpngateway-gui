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

### Step 1: 実装（完了）

- [x] 設定の形状検証（`settings-request.ts`。Phase 14より前の形状は既定値で補って受理する）
- [x] 迂回リストの照合（完全一致・`*.`ワイルドカード。両者は独立で、片方の登録が他方を含意しない。`dns-relay/domain-matcher.ts`）
- [x] DNSメッセージの解析・応答IPとTTLの抽出・SERVFAIL/切り詰め応答（`dns-relay/dns-message.ts`）、UDP/TCPの待受（`dns-relay/listener.ts`）
- [x] DoH上流への転送（ClientID付与、`dnsUpstreamCaPem`による検証、タイムアウト）と平文DNSへのフォールバック（`dns-relay/upstream.ts`）
- [x] ClientIDの生成（IPベース。クライアント名の取得先への逆引き（PTR）で得た名前があればその名前。キャッシュ・タイムアウト。`dns-relay/client-id.ts`）と、設定項目`dnsClientNameServers`（api・web・`settings-request.ts`）
- [x] 問い合わせ処理（照合・転送・setへの登録・上流障害時の挙動・上流の疎通状態。`dns-relay/relay.ts`）
- [x] `DnsRelayController`（設定の反映・待受の起動/停止/再試行・状態・監査ログ）
- [x] nft set（`bypass4`）・マーク付けチェーン・forward許可・マスカレードの追加（`network/ruleset.ts`）と、再構成時のset要素の引き継ぎ（`network/bypass-set.ts`・`gateway-controller.ts`）
- [x] `ip rule`／テーブル100の管理（`network/policy-routing.ts`。接続監視の周期で再確認）
- [x] 明示的プロキシ: 3proxyの`nserver`をリゾルバへ向ける設定生成（`explicit-proxy/config-builder.ts`）、`output`チェーンのマーク付け
- [x] 53番リダイレクト（nat prerouting、除外CIDR）
- [x] `GET /net/status`への`dnsRelay`追加
- [x] インストーラ: `send_redirects=0`のsysctl設定（`install/install.sh`）
- [x] 特権ポート（53番）のbind権限（`proxy/Dockerfile`の`setcap`）と`DNS_RELAY_PORT`の受け渡し（`compose/gateway.yml`）
- [x] 単体テスト（照合・DNSメッセージ・ClientID・上流転送（自己署名CAのHTTPSサーバ）・待受（実ソケット）・ruleset・policy-routing・bypass-set・各コントローラ）

### Step 2: 検証（検証サーバのLXDラボ・実機。完了）

検証環境は`e2e/phase14/`（`lab.sh`: LAN・ISPルータ・VPN出口・宛先サーバ・モックDNSのコンテナ群、`scenarios.sh`: 自動検証、`webgui-phase14.mjs`: Web UI）。「VPN接続」は、ゲートウェイ役のデフォルトルートを別インターフェース（VPN出口経由）へ張り替えて再現し、宛先サーバが見る接続元IPで経路を判別する。

- [x] 迂回ドメインへの通信が実回線から出て、非対象はVPN出口を経由すること（透過ゲートウェイ）
- [x] 同上（明示的プロキシ。透過ゲートウェイと併用／明示的プロキシのみ）
- [x] TTLの短いドメインでIP変化に追従し、期限（TTL＋猶予）後は迂回対象から外れること
- [x] 完全一致と`*.`ワイルドカードの照合（`example.com`のみ登録時にサブドメインが迂回されないこと、`*.example.com`のみ登録時に`example.com`が迂回されないこと）
- [x] 上流（モックDNS）にクライアントがClientID（IP由来）で区別されて渡ること
- [x] 上流停止時: フェイルクローズ／フォールバックの両方と、復旧後の状態
- [x] 53番リダイレクト有効時、手動DNS指定の端末の問い合わせ（UDP・TCP）が中継されること、除外CIDRが対象外になること
- [x] VPN未接続・Kill Switch ON時に、名前解決の中継と迂回対象の疎通は保たれ、迂回対象外は遮断されること
- [x] 設定変更による再構成後も迂回対象が維持されること、DNS中継の無効化で待受・nft・ip ruleが撤去されること
- [x] 53番ポートが使用中で待受に失敗したとき、状態が`error`になり、リダイレクトを入れず、解消後に自動回復すること
- [x] Web UI（Playwright）: 設定ダイアログの入力・保存前チェック・保持、稼働状況の「DNS中継」欄
- [x] 検証で確定した仕様（応答前のset反映、マーク後のマスカレード、特権ポート、共有IPの制約等）の`design.md`への反映
- [x] テスト用AdGuard Home（検証サーバへDockerで導入。DoHを有効化）で、履歴にクライアントが`client_id`で区別されて記録されること（当初はMAC由来。識別しにくいため、IP・名前へ変更した。下記）、フィルタのブロック応答（0.0.0.0）が迂回対象に登録されないこと
- [x] 実VPN（AdGuard VPN。利用者がWeb UIから手動ログイン済み、接続中）: 明示的プロキシ（SOCKS5・HTTP）経由で、迂回ドメインは実回線の出口IP、対象外はVPNの出口IPになること。VPNベンダーCLIのポリシールール（`ip rule`・テーブル880）が存在しても、迂回用のルール（優先度100）が優先されること（`ip route get`で、転送されるLAN機器の通信も迂回用テーブルへ向くことを確認）

- [x] 実機・実LAN端末（検証サーバのDockerのmacvlanで、デフォルトゲートウェイを検証サーバにした端末）で、透過ゲートウェイ経由の迂回（実VPN接続中）、53番リダイレクト（無効時は中継されない／有効時はUDP・TCPとも中継されて迂回setに登録される／除外CIDR宛は中継されない）を確認
- [x] 上流のDoH URLのホスト名を、ゲートウェイ機が名前解決できない場合・証明書のアドレスがURLと一致しない場合に、稼働状況が「自宅DNSサーバに接続できません」（upstream=failing）になり、フォールバックが機能すること

- [x] ClientIDの見直し（実機）: 上流のAdGuard Homeへ、クライアントのIP（`192-168-3-199`。ドット入りのClientIDは上流が異常応答を返すことを確認したためハイフン区切り）、および、クライアント名の取得先（ルータ）の逆引きで得た名前（`devsrv.lan.` → `devsrv-lan`）が渡ること。名前が得られないクライアントはIPのままであること。ルータ以外（上流のAdGuard Home）は私的な逆引きに答えないため、取得先を別に指定する仕様とした

検証: モックの範囲は、`e2e/phase14/scenarios.sh`の全シナリオ（A〜M、57項目）とWeb UIの16項目がPASS。実機（検証サーバ・実VPN・実AdGuard Home）は上記のとおり。既知の未検証事項: 複数NIC構成、Raspberry Pi実機。

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
- [x] 透過ゲートウェイ・明示的プロキシの実VPN接続を伴うシナリオ（gateway-scenariosのC以降）の、mTLS化後・3台分離構成での網羅的な再実行: `e2e/lxc/env.sh`・`e2e/lib/gw.sh`へ`GW_MODE=roles`（デプロイメント構成の分離・3台分離構成向け。web役・api役・gateway役が別ホストにある場合の`api_role`/`web_role`によるコマンド実行、web役の実際のURL`WEB_BASE`）を追加し、既存の`e2e/phase3/gateway-scenarios.sh`をそのまま`GW_MODE=roles`で実行できるようにした（`BASE`・`reset_vpn`・`gw_api_login`・`reset_operator_account`をweb役・api役の実際の配置先に対応させた。シナリオ自体のロジックは変更していない）。検証サーバの3台分離構成（`e2e/lxc/setup-roles.sh`）で`GW_MODE=roles bash e2e/phase3/gateway-scenarios.sh C D E F G H`を実行し、C・D・Eは全項目PASS（G・Hは実機専用のため既存の仕様通りスキップ）。Fの「IPv6はGWを経由せずルータ直で通信できる」はIPv6非対応という既知の制約によるもので、単一ホスト構成でも同様の結果になる（3台分離構成固有ではない）。検証中に見つけたPhase26（設定ダイアログのタブ化）への未追従の不具合を修正: `e2e/phase3/webgui-settings.mjs`が透過ゲートウェイモード・Kill Switchのチェックボックスをタブ切替無しで探しており、必ずタイムアウトしていた（「ゲートウェイ」「通信制御」の各タブを切り替えてから操作するよう修正）

# 積み残し（作業スコープ外で見つかった不具合）

- [x] インストーラ完了メッセージのWeb UIのポート表示が不正（`--web-port`を省略した再実行で、`.env`に保存済みのポートではなく既定の80を表示していた。Phase 14の実機検証中に発見）。あわせて、分離構成でwebロールがリモートの場合に`--web-port`がそのホストへ転送されていなかった関連不具合も修正した（確定した仕様は`../design.md`「本体インストーラ」の`--web-port`・ステップ9）
  - 実装: `install/setup.sh`の`summary_web_port`（ローカルは`setup_web_port`が確定した`WEB_PORT`、リモートはそのホストの`.env`をsshで読む）・`remote_role_args`（リモートの`--only-roles`実行へ渡す引数の組み立て。`--web-port`はwebロールのホストへだけ、指定時のみ転送）
  - 単体テスト（`install/tests/run.sh`）: 完了の表示（ローカルの再実行・指定時・既定、リモートの`.env`の読み取り）と`remote_role_args`の9項目を追加。修正前のコードでは7項目がFAILすることを確認。shellcheck（検証サーバ）もOK
  - E2E（`e2e/phase11/install-scenarios.sh`、検証サーバのLXC・Ubuntu 24.04）: 初回導入を`--web-port 8080`とし、完了の表示が8080であること、`--web-port`を省略した再実行でも.envが変わらず完了の表示が8080であることを追加。あわせて、Phase 17（`--providers`省略時は全ベンダー）へ未追従だった既存の検査（引数なしの再実行で.envが不変・ベンダーを決められず失敗）と、裸リポジトリの取得元パス（`--absolute-git-dir`へ）を修正。29項目FAIL 0
  - 3台分離構成（`e2e/lxc/setup-roles.sh`）: 検証サーバで、web・api・gatewayを別コンテナへ分離して`--web-port 8443`で導入し、完了の表示・web役の`.env`・実際の応答（HTTP 200）がいずれも8443であること、`--web-port`を省略した再実行でも同様に8443が維持・表示されることを確認（2026-09-28）

## 設定の動作検証（Phase 27、実装完了・検証完了）

設計は`design.md`「設定の動作検証」。

- [x] `proxy/Dockerfile`の実行イメージへ`curl`を追加
- [x] 53番リダイレクトへ、誘導した送信元を記録するset`redirected4`と`update`文を追加（`network/ruleset.ts`）と単体テスト
- [x] L1（構成監査）の実装。nftの一覧の解析とルールの特徴での照合（`verification/nft-listing.ts`・`rule-audit.ts`。実機のnft 1.0.9の出力形式でテスト）、`ip_forward`・待受の確認
- [x] L2（出口IP取得・中継リゾルバへの問い合わせ・迂回のset/経路の確認・明示的プロキシ経由の出口IP）と単体テスト（`gateway-checks.test.ts`）
- [x] 検証専用ClientID（送信元127.0.0.2→`vpngw-selfcheck`）と、検証名のローカル応答（NXDOMAIN）・受信記録・誘導の判定（`dns-relay/`・`verification/check-nonces.ts`・`redirect-record.ts`）
- [x] `POST /net/checks`・`POST /net/check-nonces`・`GET /net/check-nonces/{name}`
- [x] 実機で、`curl --interface <トンネルIF>`がトンネルへ束縛されること（ラボの模擬トンネル`eth1`、実機のAdGuard VPNの`tun0`＝ベンダーCLIのポリシールーティング下）と、実際のLAN側インターフェースから誘導した送信元がredirected4へ記録されることを確認

検証: 単体テスト（proxy 290件）。実機での通しの動作は`../tasks.md`「設定の動作検証」。

## ゲートウェイ機の再起動（Phase 29、実装完了・検証完了）

- [x] `POST /net/host-reboot`（依頼ファイルの作成、`409`・`503`の応答、監査ログ`host_reboot_requested`。`proxy/src/host-control/host-reboot.ts`）
- [x] `compose/gateway.yml`へ依頼用ディレクトリのバインドマウントを追加
- [x] `install/setup.sh`へ、依頼用ディレクトリ（10001所有・0700）・`vpngwgui-reboot.path`/`.service`の作成（`setup_host_reboot`）と、`--uninstall`での撤去（`uninstall_host_reboot`）を追加
- [x] E2E: インストール（`e2e/phase11/install-scenarios.sh`）・アンインストール（`e2e/phase20/uninstall-scenarios.sh`）にユニット・ディレクトリの確認を追加

検証: 単体テスト（`host-reboot.test.ts`）。実機（検証サーバ）で、実際にホストを再起動し、`e2e/phase29/reboot-scenarios.sh`で復旧（コンテナ・nftテーブル・依頼ファイルの除去・再起動を繰り返さないこと）を確認。

# 将来課題

- IPv6対応（現行設計はIPv4のNAT/FORWARDのみを前提としている）。
- 複数VPNベンダー・複数トンネルの同時稼働可否。
- 証明書の失効・自動ローテーション、外部認証局（Let's Encrypt等）との連携。
- 明示的プロキシへのKill Switch適用（現状はKill Switchが`forward`チェーンのみを対象とするため、VPN未接続時は`killSwitch=true`でも明示的プロキシ経由の通信が実回線から直接出る。既知の制約、`design.md`「Kill Switch」参照。対処案: 3proxy専用UIDでの起動と、そのUIDに対する`output`チェーンでのVPN未接続時dropの追加）。
- 明示的プロキシのユーザー名・パスワード認証（現状は送信元IPのCIDRのみ）。
- 設定変更時の3proxy再起動（SIGTERMから終了まで約10秒応答が途切れる）の無停止化（SIGUSR1による設定再読み込みの検討）。