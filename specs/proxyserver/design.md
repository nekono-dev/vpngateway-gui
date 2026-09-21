# SPEC-PROXY: プロキシサーバ基本設計

サービス全体設計（../design.md）で定義されたプロキシサーバの詳細設計を示す。3ファイルの中で最もホスト・ネットワークへの影響が大きく、実現難度が高い部分であるため、実装前に本ファイルの内容をレビューすること。

# コンテナ構成（Phase 11）

Phase 10までは、1つのproxyコンテナがネットワーク制御とベンダーCLIの実行を兼ね、ベンダーごとにイメージを切り替えていた。Web UIからのベンダー選択（`specs/design.md`「ベンダーの選択と実行基盤」）のため、次のように分割する。

| コンテナ（compose service） | 責務 | イメージ | 内部HTTP（UDS） |
|---|---|---|---|
| `proxy`（ネットワーク） | 透過ゲートウェイ・Kill Switch・3proxy・トンネル検出・接続監視 | `proxy/Dockerfile`（Alpine。nftables・iproute2・3proxy。**ベンダーCLIを含まない**） | `net.sock`: `POST /settings`・`GET /status`・`POST /connection-checks` |
| `runner-adguardvpn` | AdGuard VPN CLIの実行 | `proxy/Dockerfile.runner-adguardvpn`（Alpine＋CLI＋sudo。従来のAdGuard用proxyから、ネットワーク制御を除いたもの） | `runner-adguardvpn.sock`: `POST /exec`・`GET /health` |
| `runner-protonvpn` | Proton VPN CLIの実行（NetworkManager等を同梱） | `proxy/Dockerfile.runner-protonvpn`（Ubuntu。下記「Proton VPN用ランナー」） | `runner-protonvpn.sock`: `POST /exec`・`GET /health` |
| `runner-mock`（E2E専用） | モックプロバイダCLIの実行 | `proxy/Dockerfile.runner-mock`（Alpine。CLIなし。モックをマウント） | `runner-mockproton.sock` |

- **1つのnpmパッケージ、2つのエントリポイント**: `proxy/`パッケージから`dist/server.js`（ネットワーク）と`dist/runner.js`（ランナー）を作る。ランナーは、従来の`server.ts`の実行系（`isAllowedBinary`・`runCommand`・`runDetachableCommand`・`handleExec`）だけを持つ薄いサーバで、ネットワーク系（`GatewayController`・`ExplicitProxyController`・接続監視）は`server.ts`のみが持つ。共通の処理（UDSソケットの待受・JSONの入出力・監査ログ）は共有モジュールに置く。
- **`network_mode: host`**: ネットワークコンテナ・全ランナーが使う。ランナーのCLIが確立するトンネル（AdGuard: TUN、Proton: NMのWireGuard）を、ゲートウェイのネットワーク名前空間に作らせるため。ランナーは`cap_add: [NET_ADMIN]`と`/dev/net/tun`を持つ。ネットワークコンテナは`NET_ADMIN`（nftables・ip）のみ（`/dev/net/tun`は不要になる）。
- **UDS**: `ctl-socket`ボリュームを全コンテナで共有する。各コンテナは自分のソケットファイル（環境変数`CTL_SOCKET_PATH`。ネットワーク: `/var/run/vpngw-ctl/net.sock`、ランナー: `runner-<ベンダーID>.sock`）だけを作る。ソケットは`0660`、所有者は`vpngwgui`（UID 10001。APIコンテナも同UID）。

## ランナー（`dist/runner.js`）

- **`POST /exec`**: 仕様は従来（下記「内部コマンド受信サーバの仕様」）のまま。**許可リストは自分のベンダーのバイナリ1つだけ**（環境変数`RUNNER_ALLOWED_BINARY`。実運用のイメージには`ENV`でビルド時に焼き込み、composeでは上書きしない）。他のバイナリは`403 binary_not_allowed`。**従来の`EXTRA_ALLOWED_BINARIES`は廃止**し、E2Eのモックランナーは、compose（`docker-compose.e2e-mock.yml`）で`RUNNER_ALLOWED_BINARY`をモックのパスにする（モックランナーは専用のサービスで、実運用のランナーとはイメージ・許可が別）。
- **`GET /health`**: `200 { "ok": true, "binary": "<許可バイナリ>" }`。副作用なし。APIの`GET /v1/providers`が利用可否の判定に使う（ランナー内でCLIは起動しない。実行環境の準備（例: Proton VPN用ランナーのNM・keyring）が整ってからソケットを作る）。
- **実行後の即時再構成の廃止**: 従来の`handleExec`後段の`checkConnectionOnce`（接続・切断コマンド実行直後のゲートウェイルール再構成）は、ネットワークの状態を持たないランナーでは行えない。代わりにAPIが`POST /connection-checks`（下記）をネットワークコンテナへ送る。

## ネットワークコンテナ（`dist/server.js`）の変更

- **`POST /exec`を持たない**（実行系はランナーへ移動。許可リスト（`allowlist.ts`）・`command-runner.ts`はランナー側のみ）。
- **`POST /connection-checks`（新規）**: ボディなしで呼ばれると、`checkConnectionOnce`（トンネル検出→ルールの再構成）を即時に1回行い、`200 { "checked": true }`を返す。副作用は接続監視ループが行うものと同じで、冪等。失敗しても`200`（`checked: false`）とし、監視ループが追従する。APIは、接続・切断・ログアウトの実行後と、ベンダー切替後に呼ぶ。
- `POST /settings`・`GET /status`は従来どおり。トンネル検出（`ip route get`）はインターフェース名に依存しないため、ベンダーが替わっても（AdGuardのTUN・ProtonのWireGuard）そのまま追従する。

## composeの構成（Phase 11）

- サービス: `web`・`api`・`proxy`・`runner-adguardvpn`・`runner-protonvpn`・（E2Eのみ）`runner-mock`。**ランナーは`profiles: [<ベンダー>]`**で起動を選択する（`runner-adguardvpn`は既定で起動する。`profiles`を付けない）。`.env`の`COMPOSE_PROFILES`と`VPN_PROVIDERS`（APIの`ENABLED_PROVIDERS`）を`install/select-providers.sh`が書く。例: `install/select-providers.sh adguardvpn protonvpn`。
- `api`は、`./api/config/profiles`を`/etc/vpngwgui/profiles:ro`へ、`ctl-socket`・`api-data`をマウントし、`ENABLED_PROVIDERS: ${VPN_PROVIDERS:-adguardvpn}`を受け取る。`depends_on`は`proxy`のみ（ランナーは任意のため）。従来の`VPN_PROVIDER`・`docker-compose.protonvpn.yml`・`Dockerfile.<ベンダー>`による切替は廃止する。
- ボリューム: ベンダーごと（`adguard-data`、`proton-config`・`proton-keyrings`・`proton-cache`）。ベンダーを切り替えても各ベンダーのログイン情報は別々に永続化され、失われない。

# Phase 1における縮小構成

実装は`wbs/phase1.md`から段階的に行う。Phase 1では以下のように構成を縮小する。

| 項目 | 最終形（本ファイル） | Phase 1 | Phase 2 |
|---|---|---|---|
| ネットワーク | `network_mode: host` | 通常のDockerブリッジネットワーク（api/webと同一） | `network_mode: host`（当初計画はPhase 3で移行予定だったが、ブリッジネットワークがIPv6を透過せず実CLIの起動時バックエンド疎通が失敗し、コンテナ再作成のたびにログインセッションが失効する不具合が実機検証で発覚したため、この部分のみPhase 2へ前倒しした。透過ゲートウェイ・nftables等の残りはPhase 3のまま。wbs/phase2.md「次フェーズへの申し送り」参照） |
| 権限 | `cap_add: [NET_ADMIN]`, `devices: [/dev/net/tun]` | 付与しない | 付与する（実CLIがトンネルを確立するために必要。コンテナ自身のnetns内で完結するためブリッジネットワークのままでも付与可能） |
| VPNベンダーCLI | 実CLI | モックCLIスクリプト | 実CLI |
| 透過ゲートウェイ／明示的プロキシ／Kill Switch | 実装する | 実装しない（設定は永続化のみ） | Phase 1と同じ（Phase 3/4で実装） |
| インストールスクリプト | 実装する | 実装しない | Phase 1と同じ（Phase 3で実装） |

実VPNベンダーCLIへの置換を、ネットワーク基盤移行（`network_mode: host`、透過ゲートウェイ、Kill Switch）より前のPhase 2で行う理由は`wbs/README.md`「フェーズ分割の考え方」を参照。

## Phase 1: モックVPN CLI仕様

実VPNベンダーCLIの代わりに、Node.jsスクリプト（shebang付き、`proxy/mock-cli/adguardvpn-cli-mock.mjs`）で代用する。状態は`/tmp/vpngwgui-mock-state.json`（環境変数`MOCK_STATE_FILE`で上書き可）に保存する。

| argv | 動作 | stdout | exit |
|---|---|---|---|
| `connection -l <COUNTRY>` | 状態を`{"status":"connected","country":"<COUNTRY>"}`に更新 | 同JSON | 0 |
| `connection -d` | 状態を`{"status":"disconnected"}`に更新 | 同JSON | 0 |
| `connection -s` | 状態ファイルを読み取り出力（無ければdisconnected） | 状態JSON | 0 |
| `connection -l zz`（エラー注入用の特殊国コード） | 変更なし | stderrに`ERROR: no server available for zz` | 1 |

`connection -l zz`のエラー注入により、実CLIなしでAPI側の422ハンドリングを検証できる。stdoutはJSON固定とし、Phase 2で実CLI統合する際はベンダー別テキストパーサーに置換する（apiserver/design.md「Phase 1における具体プロファイル」の`outputFormat`参照）。

**実装時に判明した注意点**: APIサーバはプレースホルダー値をプロファイルの`countries`（enumFrom参照先）に対して必ず列挙値チェックする（apiserver/design.md「入力検証・セキュリティ方針」）。そのため`zz`をプロファイルの`countries`に含めておかないと、この422検証用リクエストはプロキシに到達する前にAPIサーバの400（入力エラー）で弾かれてしまう。Phase 1のプロファイル（apiserver/design.md「Phase 1における具体プロファイル」）では`countries`に`"zz"`をテスト用として含めている。

内部コマンド受信サーバの待受パスは`POST /exec`に固定する（Phase 3で設定反映用`POST /settings`を追加する際、既存仕様の変更ではなく追加で済むようにするため）。

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
- Unixドメインソケット上でlistenする（`server.listen('/var/run/vpngw-ctl/exec.sock')`）。TCPは使用しない。
- ソケットファイルはAPI・プロキシ両コンテナで共有するDocker名前付きボリュームに配置する。
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
  - **実装（Phase 3）**: `install/detect-lan-interface.sh`がデフォルトゲートウェイの逆引きで検出し、リポジトリルートの`.env`ファイル（docker composeが自動読み込みしvariable substitutionに使う、コンテナに直接マウントするファイルではない）へ`LAN_IFACE=<検出結果>`を書き出す。`docker-compose.yml`のproxyサービスが`LAN_IFACE: ${LAN_IFACE:-}`として環境変数に渡す（当初検討していた`/etc/vpngwgui/network.env`のvolumeマウント案は、ファイル未作成時のbind mount失敗を避けるため見送った）。未設定（未インストール環境）の場合、プロキシは透過ゲートウェイを構成せず撤去のみ行う（安全側）。
  - `<wan_iface>`（フェイルオープン時の送出インターフェース名）は`WAN_IFACE`環境変数で個別指定可能だが、対象ターゲット（Raspberry Pi等の単一NIC構成、../design.md参照）では未設定時`<lan_iface>`をそのまま流用する。
- nft自体の実行はプロキシコンテナ内で非root（`vpngwgui`）ユーザーが行うため、`sudo nft -f -`（標準入力からルールセットを一括投入）の形で実行する。実VPNベンダーCLIのTUN設定と同じパスワードなしsudo（`proxy/Dockerfile`）を流用し、Dockerイメージへの追加変更は不要。ルールセット全体を1回の`nft -f -`呼び出しで投入することで、複数回の`nft add ...`呼び出しに比べ、途中失敗時のルール半端適用を避けられる。

## Kill Switch

- ユーザ向け設定 `killSwitch` がONの場合: 上記 `forward` チェーン末尾の `iifname "<lan_iface>" drop` を維持する。VPN接続が確立していない、または切断された場合、`<vpn_iface>` 宛のacceptルールが存在しない（または撤去済みの）状態になるため、LAN側からのフォワード通信は自動的に遮断される（フェイルクローズ）。VPN接続状態の監視により、切断を検知した時点で該当acceptルールを即座に撤去する。
- `killSwitch` がOFFの場合: VPN切断時に、LAN側からの通信をWAN側インターフェースへ直接acceptするフォールバックルールを追加し、フェイルオープンとする。
- `killSwitch` の切替はユーザ向け設定としてAPIサーバから通知され、プロキシコンテナがnftルールを再構成することで即時反映する。
- **VPN接続状態の検出方式（実装）**: ベンダー固有のCLI出力解釈をプロキシ側に持ち込まず、`connect`/`disconnect`等のコマンド実行直後および10秒間隔の監視ループの両方で`ip route get 1.1.1.1`を再評価し、その出力インターフェースが`<lan_iface>`と異なればVPN接続中とみなす（`proxy/src/network/connection-monitor.ts`）。これにより、APIサーバ経由の明示的な切断だけでなく、ネットワーク瞬断等によるベンダーCLI側の予期しない切断にも、次回ポーリング（最大10秒）で追従する。

- **起動ガード（ホスト起動時のリーク防止）**: `ip_forward=1`は`install/setup-sysctl.sh`により起動直後から有効だが、`inet vpngwgui`テーブルはDocker→proxy→APIの設定通知を経て初めて作られる。実機の再起動検証で、この間（KS ONでも）LAN機器の通信がVPNを迂回してリークすることを確認した。これを防ぐため、`install/setup-boot-guard.sh`がsystemd oneshotユニット`vpngwgui-boot-guard.service`（`network-pre.target`・`docker.service`より前に実行）を作成し、同名テーブルへ「LAN側から入る転送はdrop（DNAT済みのみ許可）」だけを載せる。proxyは最初の`POST /settings`受信時にこのテーブルを原子的に置換する（透過ゲートウェイ無効の設定なら撤去される）。ホストへの永続変更はsysctl設定に加えこのユニット1ファイルのみ。
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

# 内部コマンド受信サーバの仕様

- リクエスト（APIサーバから、apiserver/design.md参照）: `{ vendor, binary, resolvedArgv, timeoutMs, completionPattern? }`
- **実行可能バイナリの許可リストによる内部防御**: 受信した `binary` を、プロキシコンテナ内にあらかじめ定義された既知のVPNベンダーCLIバイナリパスの許可リスト（例 `/usr/bin/adguardvpn-cli`, `/usr/bin/nordvpn`）と照合し、一致しない場合は実行を拒否する。この許可リストは、../requirements.mdで定義した「管理者向け設定」「ユーザ向け設定」とは別の、プロキシ実装内部にハードコードされたセキュリティ機構であり、両設定カテゴリとは独立して扱う。APIコンテナが将来何らかの理由で侵害・バグ混入した場合でも、プロキシ側が任意コマンド実行の踏み台にならないようにする最後の防波堤である。
- 実行:
  - `completionPattern`省略時（`connect`/`disconnect`/`status`）: `child_process.spawn(binary, resolvedArgv)`でプロセスを起動し、子プロセス自身の`'exit'`イベント（`timeoutMs`超過時はkillの上`exitCode: -1`）で完了と判定する。シェル（`exec()`）は使用しない。**`child_process.execFile`は使用しない**: execFileの完了判定は子プロセスの`'close'`イベント（stdout/stderrパイプが完全に閉じるまで）に依存するが、`connect`はバックグラウンドにVPNデーモン（孫プロセス）をforkして自身は先に終了するため、forkされたデーモンが標準出力/エラーのパイプを引き継いだまま存在し続け、`'close'`が永久に発火せずハングする不具合が実機検証で発覚した（`proxy/src/exec/command-runner.ts`の`runCommand`）。
  - `completionPattern`指定時（`login`、Phase 2で追加）: `child_process.spawn(binary, resolvedArgv)`でプロセスを起動し、stdoutを蓄積しながら`completionPattern`（正規表現）との一致を都度判定する。一致した時点でプロセスをkillせず（`child.unref()`）、その時点までのstdout/stderrを添えて`exitCode: null`で応答する。一致せずプロセスが自然終了した場合は実際のexitCodeで応答し、一致せず`timeoutMs`を超過した場合はプロセスをkillし`exitCode: -1`（タイムアウトの既存表現）で応答する。ログイン代行のようにブラウザでの認証完了まで数分かかる長時間プロセスに、応答不要な待機区間だけ非同期に対応するための拡張点である（実装: `proxy/src/exec/command-runner.ts`の`runDetachableCommand`）。
- レスポンス: `{ exitCode, stdout, stderr }`。`exitCode`は`completionPattern`一致時のみ`null`になりうる。
- すべての実行要求と結果を構造化ログとして記録する（監査ログ、apiserver/design.md参照）。

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

## `stdin`の受け渡し（Phase 9で追加）

`POST /exec`のリクエストは任意で`stdin`（文字列、最大4096バイト。apiserver/design.md「プロキシとの内部通信仕様」）を受け取る。指定された場合、`runCommand`は子プロセスの標準入力を`"pipe"`にし、`stdin`を書き込んで閉じる（未指定なら従来どおり`"ignore"`）。パスワード入力型のログイン（Proton VPN CLIの`signin`）で、パスワードをコマンド引数（`ps`で他プロセスから見える）へ載せずに渡すための手段である。

- **内容をログへ出さない**: 監査ログ（`exec_completed`等）は`argv`と`exitCode`のみを記録し、`stdin`は`stdinProvided: true`（有無）だけを記録する。標準出力・標準エラーの内容も従来どおりログしない（レスポンスにのみ含める）。
- 4096バイトを超える`stdin`は`400`（不正な形状）で拒否する（想定外の巨大な入力でプロセス・メモリを消費させないため）。
- 書き込み中の`EPIPE`（CLIが入力を読まずに終了）は無視する（プロセスの終了コードと出力で結果が分かるため）。

## 検証用の追加許可バイナリ（Phase 9で追加）

許可リスト（`allowlist.ts`）は原則ハードコードのままとするが、環境変数`EXTRA_ALLOWED_BINARIES`（カンマ区切りの絶対パス）が設定されている場合に限り、それらも許可する。**モックプロバイダCLIを使うE2E（`docker-compose.e2e-mock.yml`）専用**であり、本番の`docker-compose.yml`では設定しない。**Phase 11で`RUNNER_ALLOWED_BINARY`（ランナーごとに1つ）へ置き換え、この環境変数は廃止する**（上記「コンテナ構成（Phase 11）」）。設定できるのはコンテナを起動する管理者のみで、APIコンテナからは変更できないため、「APIコンテナ侵害時に任意コマンド実行の踏み台にならない」という許可リストの目的は損なわれない。

## Proton VPN用ランナー（Phase 10。Phase 11でproxyイメージからランナーイメージへ位置づけを変更）

Proton VPN公式CLI（`proton-vpn-cli` 1.0.3）はPythonアプリケーションで、以下に依存する（公式リポジトリのパッケージ定義・ソースで確認）。

| 依存 | 用途 | コンテナ内での用意 |
|---|---|---|
| NetworkManager（`network-manager`、`python3-proton-vpn-network-manager`系） | WireGuardトンネルの確立（NMの接続として作成・有効化） | コンテナ内でNMをシステムD-Bus上に起動する。ホストの他のインターフェースを管理させない設定にする（下記） |
| `proton-vpn-daemon` | 分割トンネリング用のD-Bus活性化サービス（公式CLIはaptの依存で要求するが、接続・ログインには不要。PoCで確認） | **起動しない**（導入のみ。postinstがsystemd無しで失敗するため、導入時の回避が必要。`wbs/phase10.md`「PoC途中の知見」） |
| gnome-keyring（Secret Service。`python3-proton-keyring-linux`） | ログインセッション（トークン）の保管 | コンテナ内のセッションバスで`gnome-keyring-daemon`を起動し、空パスワードで解錠する。保管先を永続化ボリュームにする |
| セッションD-Bus | keyring・GUI二重起動検知（CLIは起動時にセッションバスを見て、GUIアプリが動作中なら実行を拒否する） | コンテナ内でセッションバスを起動する（GUIは存在しないため二重起動検知は素通しになる） |

- **イメージ**: `proxy/Dockerfile.runner-protonvpn`（Phase 10の当初案の`Dockerfile.protonvpn`から、ランナーとして改名・縮小する。3proxy・nftables用の設定は不要になる）。Ubuntu 24.04ベース（検証環境と同一で、依存解決が確認済み）。Node.jsは公式イメージからバイナリをコピーする。3proxyはネットワークコンテナ（Alpine）にのみ含めるため、このイメージには不要。Protonの公式リポジトリ（`protonvpn-stable-release`）を追加し、`proton-vpn-cli`を導入する。イメージは大きくなる（GTK等の依存を含む）が、ランナーが分離されているためAdGuard用ランナー・ネットワークコンテナには影響しない。**Proton用ランナーは、Proton VPNを有効化した場合のみ起動する**（`COMPOSE_PROFILES`）。
- **起動構成**: PID 1は`init: true`のtiniの下でエントリポイントのスクリプトが動き、root権限でシステムD-Bus→NetworkManagerを起動し、`vpngwgui`ユーザーでセッションバス・keyringを起動してから、`vpngwgui`権限でproxy本体（Node.js）を`exec`する。バックグラウンドのいずれかが終了したらエントリポイントも終了し、`restart: always`でコンテナごと再起動する（片方だけ死んだ半端な状態で稼働し続けない）。
- **NetworkManagerの制限**: `network_mode: host`のため、NMはホストのインターフェースを見る。ホストのネットワーク（DHCP・静的設定・Docker・LXC）を奪わないよう、NMの設定で**WireGuardデバイス以外を全て`unmanaged`にする**（`[keyfile] unmanaged-devices=*,except:type:wireguard`相当。書式はPoCで確認）。Proton VPNのトンネルは、NMが作るWireGuardインターフェース（`proton0`等）で、本システムのトンネル検出（`ip route get`の出力先。`tunnel-interface.ts`）はインターフェース名に依存しないためそのまま使える。
- **Kill Switch**: Proton VPN CLIのKill Switch（`config set kill-switch`）は使わず、既定（無効）のままとして、本システムのnftablesのKill Switchに一本化する（二重の遮断規則による競合・切断後の通信不能を避ける）。PoCで既定値と、有効化されていた場合の切り戻しを確認する。
- **権限**: `cap_add: [NET_ADMIN]`、`/dev/net/tun`（従来と同じ）に加え、NMの起動のためにrootで動く。`privileged: true`は使わず、追加の権限が必要と判明した場合のみPoCの結果として個別に追加する。ノード本体・CLIの実行は`vpngwgui`（非root）とする。
- **永続化**: `~/.config/Proton/VPN`（設定）・`~/.local/share/keyrings`（keyring）・`~/.cache/Proton/VPN`（サーバー一覧のキャッシュ）と、`/etc/machine-id`（コンテナ再作成でログインが失効しないよう、AdGuard用の`docker-entrypoint.sh`と同じ方針でボリュームから復元）を永続化する。
- **PoCの合否基準**（`wbs/phase10.md`で先に実施する。不合格の場合は、ホストへ`proton-vpn-cli`・NM・daemonを導入しD-Bus・keyringのソケットをコンテナへ共有する代替へ切り替え、本節と`wbs/phase10.md`を改訂する）:
  1. コンテナ内でNM・keyringが起動し、`protonvpn status`が終了コード0で応答する。
  2. `protonvpn signin`が、TTYの無いコンテナで標準入力からパスワードを受け取れ、ログイン情報がコンテナ再作成後も保持される（keyringの永続化）。
  3. `protonvpn connect`でWireGuardのインターフェースが作られ、`ip route get 1.1.1.1`がそのインターフェースを指す。切断で元に戻る。
  4. NMがホストの既存インターフェース（物理NIC・Docker・LXC）の設定を変更しない。
  5. 本システムの透過ゲートウェイ（nftablesのNAT/FORWARD）が、そのインターフェースを経由してLAN端末の通信をVPNへ通す。

# VPNベンダーCLIの追加方法

1. （Phase 11以降）新規ベンダーのランナーコンテナのDockerイメージに、ベンダーCLIバイナリを同梱する（従来はproxyコンテナのイメージ）。
2. 管理者向け設定（VPNクライアント操作プロファイルJSON、apiserver/design.md参照）に新規ベンダーのエントリを追加する。
3. ランナーの許可バイナリ（`RUNNER_ALLOWED_BINARY`。ランナーのイメージに焼き込む）に新規バイナリのパスを設定する。
4. **【Phase 9】** プロバイダごとの機能差・プラン制限をプロファイルの`account`・`features`・`restrictedPattern`等で表現する（apiserver/design.md「Phase 9における具体プロファイル」）。
5. **【Phase 11】** そのベンダーのランナー（`proxy/Dockerfile.runner-<ベンダー>`と、`docker-compose.yml`の`runner-<ベンダー>`サービス（`profiles: [<ベンダー>]`）、ベンダー専用のボリューム）を追加する。CLIが特殊な実行環境（NetworkManager等）を必要とする場合も、その環境はこのランナーに閉じる（他のベンダーのランナー・ネットワークコンテナに影響しない）。プロファイルは`api/config/profiles/<ベンダーID>.json`。

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
      # install/detect-lan-interface.shがリポジトリルートの.envへ書き出し、docker composeが
      # variable substitutionで読み込む（コンテナへのファイルマウントではない。実装済み、docker-compose.yml参照）。
      LAN_IFACE: ${LAN_IFACE:-}
    restart: always

volumes:
  ctl-socket:
```
