# SPEC-PROXY: プロキシサーバ基本設計

サービス全体設計（../design.md）で定義されたプロキシサーバの詳細設計を示す。3ファイルの中で最もホスト・ネットワークへの影響が大きく、実現難度が高い部分であるため、実装前に本ファイルの内容をレビューすること。

# コンテナ構成（Phase 11）

Phase 10までは、1つのproxyコンテナがネットワーク制御とベンダーCLIの実行を兼ね、ベンダーごとにイメージを切り替えていた。Web UIからのベンダー選択（`specs/design.md`「ベンダーの選択と実行基盤」）のため、次のように分割する。**ベンダーCLIを実行するランナーは、別のアプリケーションとして`specs/runner/`（要件・設計・タスク）に切り出した**。本ファイルはネットワークコンテナ（`proxy`）を扱う。

| コンテナ（compose service） | 責務 | イメージ | 内部HTTP（UDS） |
|---|---|---|---|
| `proxy`（ネットワーク） | 透過ゲートウェイ・Kill Switch・3proxy・トンネル検出・接続監視 | `proxy/Dockerfile`（Alpine。nftables・iproute2・3proxy。**ベンダーCLIを含まない**） | `net.sock`: `POST /settings`・`GET /status`・`POST /connection-checks` |
| `runner-<ベンダー>` | ベンダーCLIの実行（**別仕様: `../runner/`**） | `vendors/<ベンダーID>/Dockerfile` | `runner-<ベンダーID>.sock`: `POST /exec`・`GET /health` |

- **1つのnpmパッケージ、2つのエントリポイント**: `proxy/`パッケージから`dist/server.js`（ネットワーク）と`dist/runner.js`（ランナー。`specs/runner/design.md`）を作る。ネットワーク系（`GatewayController`・`ExplicitProxyController`・接続監視）は`server.ts`のみが持つ。共通の処理（UDSソケットの待受・JSONの入出力・監査ログ）は共有モジュール（`lib/`）に置く。
- **`network_mode: host`**: ネットワークコンテナ・全ランナーが使う（ランナー側の理由は`specs/runner/design.md`）。ネットワークコンテナは`NET_ADMIN`（nftables・ip）のみ持つ（`/dev/net/tun`は不要になった）。
- **UDS**: `ctl-socket`ボリュームを全コンテナで共有する。各コンテナは自分のソケットファイル（環境変数`CTL_SOCKET_PATH`。ネットワーク: `/var/run/vpngw-ctl/net.sock`、ランナー: `runner-<ベンダーID>.sock`）だけを作る。ソケットは`0660`、所有者は`vpngwgui`（UID 10001。APIコンテナも同UID）。

## ネットワークコンテナ（`dist/server.js`）の変更

- **`POST /exec`を持たない**（実行系はランナーへ移動。許可リスト（`allowlist.ts`）・`command-runner.ts`はランナー側のみ）。
- **`POST /connection-checks`（新規）**: ボディなしで呼ばれると、`checkConnectionOnce`（トンネル検出→ルールの再構成）を即時に1回行い、`200 { "checked": true }`を返す。副作用は接続監視ループが行うものと同じで、冪等。失敗しても`200`（`checked: false`）とし、監視ループが追従する。APIは、接続・切断・ログアウトの実行後と、ベンダー切替後に呼ぶ。
- `POST /settings`・`GET /status`は従来どおり。トンネル検出（`ip route get`）はインターフェース名に依存しないため、ベンダーが替わっても（AdGuardのTUN・ProtonのWireGuard）そのまま追従する。

## composeの構成（Phase 11）

- サービス: composeの本体（`docker-compose.yml`）は`web`・`api`・`proxy`だけを持つ。`runner-<ベンダー>`は、ベンダーバンドル（`vendors/<ベンダーID>/compose.yml`。`specs/runner/design.md`）が持ち、有効にしたベンダーのものだけを`.env`の`COMPOSE_FILE`へ並べる（Phase 12。従来の`profiles`・`COMPOSE_PROFILES`・AdGuardの特例は廃止）。`.env`の`VPN_PROVIDERS`（APIの`ENABLED_PROVIDERS`）と`COMPOSE_FILE`は`install/install.sh`が書く。
- `api`は、`./vendors`を`/etc/vpngwgui/vendors:ro`へ、`ctl-socket`・`api-data`をマウントし、`ENABLED_PROVIDERS: ${VPN_PROVIDERS:?...}`（必須。既定なし）を受け取る。`depends_on`は`proxy`のみ（ランナーは任意のため）。
- ボリューム: ネットワークコンテナは`ctl-socket`のみ。ベンダーごとのログイン情報のボリュームはランナーの仕様（`specs/runner/design.md`）。

# Phase 1における縮小構成（履歴。Phase 1のモックVPN CLI仕様は`../runner/design.md`へ移動）

実装は`wbs/phase1.md`から段階的に行う。Phase 1では以下のように構成を縮小する。

| 項目 | 最終形（本ファイル） | Phase 1 | Phase 2 |
|---|---|---|---|
| ネットワーク | `network_mode: host` | 通常のDockerブリッジネットワーク（api/webと同一） | `network_mode: host`（当初計画はPhase 3で移行予定だったが、ブリッジネットワークがIPv6を透過せず実CLIの起動時バックエンド疎通が失敗し、コンテナ再作成のたびにログインセッションが失効する不具合が実機検証で発覚したため、この部分のみPhase 2へ前倒しした。透過ゲートウェイ・nftables等の残りはPhase 3のまま。wbs/phase2.md「次フェーズへの申し送り」参照） |
| 権限 | `cap_add: [NET_ADMIN]`, `devices: [/dev/net/tun]` | 付与しない | 付与する（実CLIがトンネルを確立するために必要。コンテナ自身のnetns内で完結するためブリッジネットワークのままでも付与可能） |
| VPNベンダーCLI | 実CLI | モックCLIスクリプト | 実CLI |
| 透過ゲートウェイ／明示的プロキシ／Kill Switch | 実装する | 実装しない（設定は永続化のみ） | Phase 1と同じ（Phase 3/4で実装） |
| インストールスクリプト | 実装する | 実装しない | Phase 1と同じ（Phase 3で実装） |

実VPNベンダーCLIへの置換を、ネットワーク基盤移行（`network_mode: host`、透過ゲートウェイ、Kill Switch）より前のPhase 2で行う理由は`wbs/README.md`「フェーズ分割の考え方」を参照。

# ネットワーク構成

## `network_mode: host` の採用理由

透過ゲートウェイモードでは、LAN上の他デバイスからのフォワード通信を、VPNベンダーCLIが確立するトンネルインターフェース（tun/wg系、名称はベンダー・バージョン依存で固定できない）へ到達させる必要がある。これは実質的にプロキシコンテナがホストのネットワーク名前空間を共有する（`network_mode: host`）以外に実用的な方法がない。コンテナを独立したnetnsのまま透過ゲートウェイとして機能させるには、veth・ポリシールーティング等による追加のブリッジ構成が必要になり、Raspberry Pi等の非力機を含む単一ホスト構成というターゲットには不釣り合いに複雑になるため採用しない。

docker-composeの仕様上、`network_mode: host` と `networks:`（ユーザー定義ブリッジ）は併用できない。そのため、プロキシコンテナはWeb/APIコンテナと同一のDockerブリッジネットワークには参加せず、TCPベースの内部通信もできない。

## 必要な権限・デバイス

- `cap_add: [NET_ADMIN]` — IPフォワーディング設定、nftablesルール操作に必要。
- `devices: ["/dev/net/tun:/dev/net/tun"]` — VPNベンダーCLIがtunデバイスを利用する場合に必要。
- `privileged: true` は使用しない。上記2つで不足する場合（一部ベンダーCLIがWireGuardカーネルモジュールのロードに`SYS_MODULE`を要求する等）のみ、実装時のPoCで個別に追加検討する。対象OS（Debian/RaspberryPiOS、Ubuntu 24.04）は標準カーネルにWireGuardがビルトインされているため、通常は不要と想定する。

## 内部コマンド受信サーバ（UDS制御チャネル）

- Node.js組み込み `http` モジュールで実装する（外部フレームワーク不要、極小のエンドポイント数のため）。
- Unixドメインソケット上でlistenする（ネットワークコンテナは`/var/run/vpngw-ctl/net.sock`、ランナーは`runner-<ベンダーID>.sock`。Phase 10までは単一の`exec.sock`）。TCPは使用しない。
- ソケットファイルはAPIと各コンテナ（ネットワーク・ランナー）で共有するDocker名前付きボリュームに配置する。
- 起動時、残存ソケットファイル（前回異常終了時の残骸）を `unlink` してから `listen` する（`EADDRINUSE` 対策）。
- `listen` 完了後、`fs.chmodSync(socketPath, 0o770)` でパーミッションを明示的に制限する（Node.jsの `listen()` はソケットファイルのパーミッションを引き継がない）。
- API・プロキシ両コンテナを同一UID/GID（例: 専用ユーザー、両コンテナで `user: "1000:1000"` を明示）で起動し、ソケットファイルへのアクセスをそのUIDに限定する。
- **この経路は、ネットワーク的にコンテナ外部（LAN含む）から到達不可能である。** TCP + `127.0.0.1` バインドは、`network_mode: host` のプロキシコンテナに対しては別ネットワーク名前空間のAPIコンテナから到達できないため不採用。TCP + `0.0.0.0` バインドはLAN全体に露出し要件に抵触するため不採用。UDSはネットワーク層を経由しないため、この制約を確実に満たす。

# 透過ゲートウェイモードの実現方式

## IPフォワーディングの永続化

`network_mode: host` のプロキシコンテナは、ホストのネットワーク名前空間を共有するため、コンテナ内から `/proc/sys/net/ipv4/ip_forward` へ書き込む操作はホストのカーネル設定を直接変更する操作と等価である。

- **インストールスクリプトが、ホスト上に永続設定ファイル（例 `/etc/sysctl.d/99-vpngwgui.conf` に `net.ipv4.ip_forward=1`）を1つ作成し、`sysctl --system` を実行する。** これは「ホストの変更を最小限に抑える（＝変更するファイル数を最小限にする）」という方針に沿った、必要最小限の永続的ホスト変更である。プロキシコンテナが `restart: always` で永続稼働するデーモンである以上、この設定はコンテナ起動のたびに動的に行うのではなく、インストール時に一度だけ永続化するのが妥当である。
- プロキシコンテナの起動時にも念のため `/proc/sys/net/ipv4/ip_forward` の値を確認し、0であれば1に設定を試みる（コンテナが再作成された環境でインストールスクリプトを再実行していないケースへのフォールバック）。**ただしDockerはコンテナの`/proc/sys`を読み取り専用でマウントするため、`NET_ADMIN`を付与していても書き込みは`Read-only file system`で失敗し、このフォールバックは実際には機能しない（実機検証で確認）。** 補正できなかった場合は監査ログへ`ip_forward_disabled`イベントを記録して警告する（無音にしない）。実質的な解決手段はインストールスクリプト（`install/setup-sysctl.sh`）の実行のみである。

## NAT/FORWARDルール

- Debian/RaspberryPiOS・Ubuntu 24.04 はいずれも `iptables` パッケージが `iptables-nft`（`nf_tables` バックエンド）をデフォルトとするが、コンテナ内の `iptables` バイナリがどちらのバックエンドを指すかはベースイメージ依存で曖昧になりうる。**`iptables` コマンドではなく `nft` コマンドを直接使用する**ことで、legacy/nftバックエンドの曖昧さを排除する。
- 専用テーブル名（例 `inet vpngwgui`）で独立に管理し、ホスト上の既存ルール（ufw等）と衝突・意図せぬ上書きが起きないようにする。プロキシコンテナ停止時は `nft delete table inet vpngwgui` でクリーンに撤去する。
- ルール構成（概念）:
  - `nft add table inet vpngwgui`
  - `nft add chain inet vpngwgui postrouting { type nat hook postrouting priority 100 ; }`
  - `nft add rule inet vpngwgui postrouting oifname "<vpn_iface>" masquerade`
  - `nft add chain inet vpngwgui forward { type filter hook forward priority 0 ; policy accept ; }`
  - `nft add rule inet vpngwgui forward ct status dnat accept`（Dockerの公開ポート宛の転送とその応答を常に許可する。これが無いとLAN側からWeb UI（webコンテナの公開ポート）へも到達できなくなる。ゲートウェイ転送通信はDNATされないためKill Switchの遮断範囲には影響しない。実機検証で発覚）
  - `nft add rule inet vpngwgui forward oifname != "<lan_iface>" ct direction reply ct state established,related accept`（LAN側以外へ向かう応答方向の確立済み通信。単一NIC構成では同居コンテナ自身のインターネット向け通信の応答もLAN側インターフェースから入ってくるため、末尾のdropに巻き込まないための許可。`ct direction reply`によりLAN機器発の確立済み通信は含まれない）
  - `nft add rule inet vpngwgui forward iifname "<lan_iface>" oifname "<vpn_iface>" accept`（VPN接続中のみ）
  - `nft add rule inet vpngwgui forward iifname "<vpn_iface>" oifname "<lan_iface>" ct state established,related accept`（VPN接続中のみ）
  - `nft add rule inet vpngwgui forward iifname "<vpn_iface>" drop`（VPN接続中のみ。トンネル側からのLAN機器宛の新規接続を拒否）
  - `nft add rule inet vpngwgui forward iifname "<lan_iface>" drop`（**常に末尾**。上記に該当しなかったLAN側発の転送を遮断する）
- **`forward`チェーンは`policy accept`とし、遮断対象は末尾の`iifname "<lan_iface>" drop`で「LAN側インターフェースから入ってきた転送」のみに限定する。** `policy drop`だと、同居する他のDockerコンテナ等ゲートウェイ機能と無関係な転送（コンテナのインターネット向け通信）まで遮断してしまうため（実機検証で、透過GW有効・VPN未接続・KS ONの間も同居コンテナの通信が継続することを確認）。この末尾のdropがKill Switchの基礎になる（後述）。
- **ルールセットの置換は原子的に行う。** 組み立てたスクリプトの先頭を「`add table`→`delete table`→`add table`」とし、`nft -f`の1トランザクションで旧ルールの撤去と新ルールの適用を同時に行う（既存テーブルの有無に関わらずエラーにならない）。撤去と適用を別呼び出しにすると、その間フィルタが存在せずLAN機器の通信が漏れる一瞬ができるため。あわせて、APIの定期再通知（後述）で設定・VPN接続状態が前回成功した適用と同じ場合は再構成自体を行わない（`GatewayController.applySettings()`）。
- **VPNトンネルのインターフェース名（`<vpn_iface>`）は動的に検出する。** ベンダー・バージョンにより `tun0`・`nordlynx` 等固定できないため、VPN接続完了後に `ip route get 1.1.1.1`（公開IP宛の経路選択結果。パケットは送信しない）の出力インターフェースを取得し、それを用いてルールを再適用する。`ip route show default`（メインテーブルのみ参照）を使わない理由: 実機検証で、AdGuard VPN CLI（TUNモード）はメインテーブルのデフォルトルートを書き換えず、ポリシールーティング（`ip rule`の優先度30801で専用テーブル880を優先参照し、テーブル880に全IPv4を`dev tun0`向けで投入）で通信を切り替えることが判明したため。`ip route get`はポリシールーティングを含めたカーネルの実際の経路選択結果を返すため、default置換型・ポリシールーティング型のどちらのベンダーにも対応できる。再接続・国変更のたびに旧ルールを撤去し、新インターフェース名で再適用する。
- `<lan_iface>`（LAN側インターフェース名）は、インストールスクリプト実行時に検出し設定ファイルへ書き出し、プロキシコンテナ起動時に環境変数/設定ファイル経由で読み込む（ハードコードしない）。
  - **実装（Phase 3）**: `install/install.sh`（Phase 13で従来の`detect-lan-interface.sh`を統合）がデフォルトゲートウェイの逆引きで検出し、リポジトリルートの`.env`ファイル（docker composeが自動読み込みしvariable substitutionに使う、コンテナに直接マウントするファイルではない）へ`LAN_IFACE=<検出結果>`を書き出す。`docker-compose.yml`のproxyサービスが`LAN_IFACE: ${LAN_IFACE:-}`として環境変数に渡す（当初検討していた`/etc/vpngwgui/network.env`のvolumeマウント案は、ファイル未作成時のbind mount失敗を避けるため見送った）。未設定（未インストール環境）の場合、プロキシは透過ゲートウェイを構成せず撤去のみ行う（安全側）。
  - `<wan_iface>`（フェイルオープン時の送出インターフェース名）は`WAN_IFACE`環境変数で個別指定可能だが、対象ターゲット（Raspberry Pi等の単一NIC構成、../design.md参照）では未設定時`<lan_iface>`をそのまま流用する。
- nft自体の実行はプロキシコンテナ内で非root（`vpngwgui`）ユーザーが行うため、`sudo nft -f -`（標準入力からルールセットを一括投入）の形で実行する。実VPNベンダーCLIのTUN設定と同じパスワードなしsudo（`proxy/Dockerfile`）を流用し、Dockerイメージへの追加変更は不要。ルールセット全体を1回の`nft -f -`呼び出しで投入することで、複数回の`nft add ...`呼び出しに比べ、途中失敗時のルール半端適用を避けられる。

## Kill Switch

- ユーザ向け設定 `killSwitch` がONの場合: 上記 `forward` チェーン末尾の `iifname "<lan_iface>" drop` を維持する。VPN接続が確立していない、または切断された場合、`<vpn_iface>` 宛のacceptルールが存在しない（または撤去済みの）状態になるため、LAN側からのフォワード通信は自動的に遮断される（フェイルクローズ）。VPN接続状態の監視により、切断を検知した時点で該当acceptルールを即座に撤去する。
- `killSwitch` がOFFの場合: VPN切断時に、LAN側からの通信をWAN側インターフェースへ直接acceptするフォールバックルールを追加し、フェイルオープンとする。
- `killSwitch` の切替はユーザ向け設定としてAPIサーバから通知され、プロキシコンテナがnftルールを再構成することで即時反映する。
- **VPN接続状態の検出方式（実装）**: ベンダー固有のCLI出力解釈をプロキシ側に持ち込まず、`connect`/`disconnect`等のコマンド実行直後および10秒間隔の監視ループの両方で`ip route get 1.1.1.1`を再評価し、その出力インターフェースが`<lan_iface>`と異なればVPN接続中とみなす（`proxy/src/network/connection-monitor.ts`）。これにより、APIサーバ経由の明示的な切断だけでなく、ネットワーク瞬断等によるベンダーCLI側の予期しない切断にも、次回ポーリング（最大10秒）で追従する。

- **起動ガード（ホスト起動時のリーク防止）**: `ip_forward=1`は`install/install.sh`（従来の`setup-sysctl.sh`）により起動直後から有効だが、`inet vpngwgui`テーブルはDocker→proxy→APIの設定通知を経て初めて作られる。実機の再起動検証で、この間（KS ONでも）LAN機器の通信がVPNを迂回してリークすることを確認した。これを防ぐため、`install/install.sh`（従来の`setup-boot-guard.sh`）がsystemd oneshotユニット`vpngwgui-boot-guard.service`（`network-pre.target`・`docker.service`より前に実行）を作成し、同名テーブルへ「LAN側から入る転送はdrop（DNAT済みのみ許可）」だけを載せる。proxyは最初の`POST /settings`受信時にこのテーブルを原子的に置換する（透過ゲートウェイ無効の設定なら撤去される）。ホストへの永続変更はsysctl設定に加えこのユニット1ファイルのみ。
- **IPv6は対象外（既知の制約）**: 透過ゲートウェイはIPv4のみを転送・遮断する。LAN機器がルータのRAでIPv6のデフォルトゲートウェイをルータ自身から得ている場合、その通信はゲートウェイを経由せず、Kill Switch・VPNのいずれも迂回してルータ直で外部へ出る（実機検証で、IPv4が遮断／VPN経由の状態でもLAN機器のIPv6が実アドレスで通信できることを確認）。対処は運用側で行う（LAN側ルータでIPv6のRA配布を止める、LAN機器のIPv6を無効化する等）。ゲートウェイ側でのIPv6転送・NAT66は行わない。

# 明示的プロキシモードの実現方式

- SOCKS5とHTTP(CONNECT)の両方を単一プロダクトでサポートする必要があるため、**3proxy**（軽量Cバイナリ、SOCKS4/5・HTTP・HTTP CONNECTに対応）を採用する。SOCKS5専用のmicrosocksやHTTP専用のtinyproxy単体では要件を満たさない。
- 3proxyは自身でルーティングを制御せず、OSのルーティングテーブルに従って発信するだけである。プロキシコンテナのデフォルトルートがVPNベンダーCLIによってトンネル経由に切り替わっていれば、3proxy側は特別な設定なしに自動的にVPN越しの通信になる。透過ゲートウェイモードのnftables管理とは独立して機能する。
- `network_mode: host` を採用しているため、3proxyがLAN向けにbindするポート（例 SOCKS5:1080, HTTP:8080）はDockerのポートマッピングを介さずホストのLANインターフェースに直接listenできる。
- Node/TS側の責務:
  1. ユーザ向け設定（`explicitProxyEnabled`、`explicitProxyAllowedCidrs`等）変更時、3proxyの設定ファイルをテンプレートから生成する。
  2. `child_process.spawn` で3proxyを起動・監視し、異常終了時は再起動する。
  3. VPN接続状態の変化に伴う3proxyの再起動は不要（ルーティングに自動追従するため）。設定変更（ポート変更等）時のみ再起動する。

## 実装（Phase 4）

- **同梱方法**: Alpine 3.24のmain/communityリポジトリに3proxyパッケージが無く（edge/testingのみ）、testingのバイナリは実行ステージのlibcと版が食い違いうるため、`proxy/Dockerfile`の専用ビルドステージで公式リリース（`THREEPROXY_VERSION`、動作確認済み0.9.5）のソースを`make -f Makefile.Linux`でビルドし、`/usr/local/bin/3proxy`のバイナリ1つだけを実行イメージへ渡す（動的リンクはmuslのみ）。ビルド時にGitHubへのネットワークアクセスが必要（実VPN CLIの取得と同じ）。
- **待ち受けポート**: SOCKS5=`1080`、HTTP(CONNECT含む)=`3128`（環境変数`EXPLICIT_SOCKS_PORT`・`EXPLICIT_HTTP_PORT`で変更可）。HTTPの既定を`8080`としないのは、Web UI（webコンテナがホストの8080を公開）と衝突するため。`network_mode: host`のため、ホストの全インターフェースへbindする（LAN側IPへの限定はしない。接続の可否は下記の許可元CIDRのみで決まる）。
- **設定ファイル**（`proxy/src/explicit-proxy/config-builder.ts`。既定の出力先`/tmp/vpngwgui/3proxy.cfg`、環境変数`EXPLICIT_PROXY_CONFIG`で変更可。一時ファイル→renameで原子的に書き出す）:
  ```
  auth iponly
  allow * <CIDR>,<CIDR>...
  deny *
  socks -p1080
  proxy -p3128
  ```
  認証は送信元IPのみ（`auth iponly`）。許可元CIDR以外は`deny *`で拒否する（SOCKS5は接続拒否、HTTPは403）。ユーザ名・パスワード認証は行わない（LAN限定運用。Phase 7の認証導入時に検討）。
- **許可CIDRの検証**: CIDRは設定ファイルの行へ埋め込むため、改行等による設定行の注入（例: `192.168.3.0/24\nallow * 0.0.0.0/0`）で許可範囲が意図せず拡大しないよう、APIサーバ（`PUT /v1/connection/config`。400で拒否、`api/src/settings/settings-store.ts`）とproxy（`buildExplicitProxyConfig`。例外→`error`状態）の両方でIPv4 CIDR形式（`a.b.c.d/n`）を厳密に検証する。プレフィックス長を省略した単一ホスト表記（`192.168.3.5`）は受理しない（`/32`を明示する）。IPv6は対象外。
- **許可CIDRが空**の場合は3proxyを起動せず`unconfigured`とする（全拒否の設定で起動しても利用者にとって意味が無く、全許可にフォールバックするのは危険なため）。
- **プロセス監視**（`explicit-proxy-controller.ts`の`ExplicitProxyController`。透過ゲートウェイの`GatewayController`と同じく「いつ起動・停止するか」の調停のみを担う）:
  - `POST /settings`受信ごとに`applySettings()`を呼ぶ。APIは設定を10秒周期で再通知するため、前回反映済みと同じ内容（有効/無効・CIDR列が同一）なら何もしない（不要な再起動でプロキシ接続を切らない）。設定ファイルの生成・書き込みに失敗した場合は`error`状態とし、次回の再通知で再試行する。
  - 設定変更時は旧プロセスへSIGTERMを送り、**終了を待ってから**新設定で起動する（ポート競合の回避）。3proxyはSIGTERMから終了まで約5秒かかる（実機で計測）ため、SIGKILLへ切り替えるまでの猶予は10秒とする。したがって設定変更中は最大約5秒プロキシが応答しない。意図的な終了は異常終了として数えない。
  - 異常終了（`kill -9`等）は指数バックオフ（1秒→2秒→4秒…、上限60秒）で再起動する。連続3回の異常終了で`crashLoop`と報告する（再起動は試み続ける）。プロセスが30秒以上生き続ければ安定とみなし、連続失敗回数・バックオフをリセットして`crashLoop`が解消する。設定変更は新しい状況とみなし、バックオフ待ちを打ち切って即座に新設定で起動する。
  - 起動失敗（バイナリ不在等で`exit`が来ず`error`イベントのみの場合）も異常終了と同じ扱いとする。
  - 3proxyの標準出力・標準エラーはコンテナのログへそのまま流す。3proxyの接続ログは有効化しない（通信内容の記録を避ける）。起動・停止・異常終了・crashLoopは監査ログ（`explicit_proxy_started`/`explicit_proxy_stopped`/`explicit_proxy_crashed`/`explicit_proxy_crash_loop`/`explicit_proxy_config_error`）へ記録する。
- **VPN接続状態との独立**: VPNの接続・切断・国変更で3proxyは再起動しない（実機でPID不変を確認）。3proxyはOSのルーティングに従って発信するため、VPN接続中は出口がVPN側になり、切断中は実回線から直接出る。
- **Kill Switchの対象外（既知の制約）**: Kill Switchは`inet vpngwgui`の`forward`チェーン（透過ゲートウェイの転送）のみを制御する。明示的プロキシはホスト自身の発信（`output`）であるため、**VPN未接続の間は`killSwitch=true`でも実回線から直接インターネットへ抜ける**（実機で実測）。利用者が意図しない直接通信を避けたい場合は、VPN接続時のみプロキシを使う運用とする。対処（3proxy専用のUIDに対する`output`チェーンのdrop等）はPhase 7の課題とする。

# ユーザ向け設定の反映方法

| 設定項目 | 反映先 |
|---|---|
| `killSwitch` | nftables `forward` チェーンのフォールバックルール有無 |
| `excludedDomains` | 3proxyの除外設定、および透過ゲートウェイ側では該当ドメインの名前解決結果IPをVPN迂回ルーティング（ポリシールーティング）に反映（実装詳細は別途検討） |
| `transparentGatewayEnabled` | nftables `inet vpngwgui` テーブルの適用/撤去 |
| `explicitProxyEnabled` | 3proxyプロセスの起動/停止 |
| `explicitProxyAllowedCidrs` | 3proxy設定ファイルの許可元CIDR |

`excludedDomains`（ドメイン単位のsplit-tunnel除外）はIPベースのnftables/ルーティングでは本来IP単位でしか制御できないため、名前解決結果の変化（DNS TTL）に伴うルール更新の仕組みが必要になる。この点は実装時に別途詳細設計を行う（本ファイルでは方針のみ示す）。

（ベンダーCLIの実行要求`POST /exec`は、Phase 11でランナーへ移動した。仕様は`../runner/design.md`「`POST /exec`（内部コマンド受信サーバ）の仕様」。以下はネットワークコンテナ（`net.sock`）の内部HTTP。）

## `POST /settings`（設定反映、Phase 3で追加）

具体的なリクエスト/レスポンス形状はapiserver/design.md「設定反映（`POST /settings`）内部プロトコル仕様」参照。プロキシ側の処理は以下の通り（実装: `proxy/src/server.ts`の`handleSettings`）。

1. `killSwitch`・`transparentGatewayEnabled`・`explicitProxyEnabled`のboolean、`explicitProxyAllowedCidrs`の文字列配列という形状のみを検証する（他フィールド（`excludedDomains`はPhase 6で利用予定）は無視。個々のCIDRの形式は設定ファイル生成時に検証する）。形状不正は400。
2. `GatewayController.applySettings()`（`proxy/src/network/gateway-controller.ts`）へ渡し、現在のVPN接続インターフェース状態と合わせてnftルールセットを撤去→再適用する。
3. `ExplicitProxyController.applySettings()`（`proxy/src/explicit-proxy/explicit-proxy-controller.ts`）へ渡し、3proxyを起動・再起動・停止する（上記「実装（Phase 4）」）。透過ゲートウェイのnft再構成とは独立して行う。
4. 結果（`applied: boolean`。透過ゲートウェイのnft適用結果のみを表す）を応答し、監査ログへ記録する。

## `GET /status`（稼働状況取得、Phase 5で追加）

`GatewayController`（`proxy/src/network/gateway-controller.ts`）が保持する現在状態を、副作用なしで返す読み取り専用エンドポイント。`/exec`・`/settings`と同一UDSソケット上、OpenAPI非公開。APIサーバの`GET /v1/connection/gateway`が中継する（形状はapiserver/design.md「稼働状況取得」参照）。

- 情報源は`GatewayController`のメモリ上の状態（適用中の`killSwitch`/`transparentGatewayEnabled`、検出済みVPN IF名、`LAN_IFACE`有無）のみとし、状態取得のためにnft/ipコマンドを新たに実行しない（ポーリング頻度（5秒×閲覧者数）でsudo実行が発生するのを避けるため）。
- したがって値は「proxyが最後に適用を試みた結果」であり、外部から`nft`で手動変更された場合の乖離は検知しない（Phase 7以降の課題）。
- レスポンスは`{ "transparentGateway": { "state", "vpnInterface"?, "killSwitchBlocking" }, "explicitProxy": { "state", "socksPort"?, "httpPort"?, "restartCount" } }`（`GatewayController.getStatus()`・`ExplicitProxyController.getStatus()`）。`transparentGateway.state`は`active`/`stopped`/`unconfigured`/`error`（有効設定だが直近のnft適用が失敗、または再構成の完了前）。設定受信前（プロセス起動直後）は既定設定に基づき`stopped`を返す。
- `explicitProxy.state`は`active`（稼働中。一時的な再起動待ちを含む。`socksPort`・`httpPort`はこの状態のみ付く）/`stopped`（無効）/`unconfigured`（有効設定だが許可CIDRが空）/`crashLoop`（起動直後の異常終了を連続して繰り返している）/`error`（設定ファイルの生成・書き込みに失敗）。`restartCount`はプロキシ起動以降の異常終了による再起動回数（設定変更による意図的な再起動は含まない）。プロセスの実在確認のための外部コマンドは実行しない。
- **異常状態のAPIへの通知経路**: `crashLoop`等は、APIサーバが`GET /v1/connection/gateway`のたびにこのエンドポイントを引いて中継する（pull方式）ことでUI・API利用者へ届く。proxy→apiへの能動的なpush用の経路（APIサーバ側の受信口）は新設しない: APIサーバは状態を持たない方針（apiserver/design.md）で、UIは5秒ポーリングにより最大約5秒で異常を表示でき、push経路を足すと内部プロトコルの信頼境界（proxyからapiへの経路は無い）を広げるため。異常は監査ログにも残る。

# 障害時の挙動

- VPN接続断検知時: 監視プロセスが `ip route get` 等でトンネル経路の消失を検知し、Kill Switch設定に従ってnftablesルールを即座に更新する（上記「Kill Switch」節参照）。
- 3proxyプロセスの異常終了: `ExplicitProxyController`が検知し再起動する。連続的なクラッシュループの場合は再起動間隔を指数バックオフし（上限60秒）、`GET /status`の`explicitProxy.state=crashLoop`としてAPI・Web UIへ通知する（上記「実装（Phase 4）」・「`GET /status`」。Phase 4で実装）。
- プロキシコンテナ自体の再起動時: 3proxyもコンテナとともに停止し、APIの設定再通知（最大約10秒）で設定を受信した時点で自動的に再起動する（実機で確認）。
- プロキシコンテナ自体の再起動時: **起動時にnftablesルールを撤去しない**。プロキシは自身のプロセス内メモリにのみ現在の`killSwitch`/`transparentGatewayEnabled`を保持し永続化しないため、起動直後は現在の設定を知らない。この状態で撤去すると、設定を受信するまでの間Kill Switchが効かず、LAN機器の通信がVPNを迂回してリークする（実機検証で確認。プロキシコンテナ再起動でVPNデーモンも停止するため、KS ONのまま実IPで通信できてしまう）。既存のルールは、最初の`POST /settings`受信時の「全撤去→再適用」（`GatewayController.applyCurrentState()`）で置き換わり、その際に前回異常終了時の残骸も同時に掃除される。
  - APIサーバは現在の設定を10秒周期（`SETTINGS_RESYNC_INTERVAL_MS`）で`POST /settings`へ再通知するため（`api/src/server.ts`）、プロキシのみが再起動・再作成された場合でも最大約10秒で設定が反映される。この間はプロセス再起動前のルールがカーネルに残り続けるためフェイルクローズが維持される。

# docker-compose.yml 概念構成（プロキシサービス抜粋）

```yaml
services:
  proxy:
    build: ./proxy
    network_mode: host        # networks: とは併用不可
    cap_add: [NET_ADMIN]
    devices:
      - /dev/net/tun:/dev/net/tun
    volumes:
      - ctl-socket:/var/run/vpngw-ctl
    environment:
      # install/install.shがリポジトリルートの.envへ書き出し、docker composeが
      # variable substitutionで読み込む（コンテナへのファイルマウントではない。実装済み、docker-compose.yml参照）。
      LAN_IFACE: ${LAN_IFACE:-}
    restart: always

volumes:
  ctl-socket:
```
