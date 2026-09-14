# SPEC-PROXY: プロキシサーバ基本設計

サービス全体設計（../design.md）で定義されたプロキシサーバの詳細設計を示す。3ファイルの中で最もホスト・ネットワークへの影響が大きく、実現難度が高い部分であるため、実装前に本ファイルの内容をレビューすること。

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
- プロキシコンテナの起動時にも念のため `/proc/sys/net/ipv4/ip_forward` の値を確認し、0であれば1に設定する（コンテナが再作成された環境でインストールスクリプトを再実行していないケースへのフォールバック）。

## NAT/FORWARDルール

- Debian/RaspberryPiOS・Ubuntu 24.04 はいずれも `iptables` パッケージが `iptables-nft`（`nf_tables` バックエンド）をデフォルトとするが、コンテナ内の `iptables` バイナリがどちらのバックエンドを指すかはベースイメージ依存で曖昧になりうる。**`iptables` コマンドではなく `nft` コマンドを直接使用する**ことで、legacy/nftバックエンドの曖昧さを排除する。
- 専用テーブル名（例 `inet vpngwgui`）で独立に管理し、ホスト上の既存ルール（ufw等）と衝突・意図せぬ上書きが起きないようにする。プロキシコンテナ停止時は `nft delete table inet vpngwgui` でクリーンに撤去する。
- ルール構成（概念）:
  - `nft add table inet vpngwgui`
  - `nft add chain inet vpngwgui postrouting { type nat hook postrouting priority 100 ; }`
  - `nft add rule inet vpngwgui postrouting oifname "<vpn_iface>" masquerade`
  - `nft add chain inet vpngwgui forward { type filter hook forward priority 0 ; policy drop ; }`
  - `nft add rule inet vpngwgui forward iifname "<lan_iface>" oifname "<vpn_iface>" accept`
  - `nft add rule inet vpngwgui forward iifname "<vpn_iface>" oifname "<lan_iface>" ct state established,related accept`
- `forward` チェーンの `policy drop` はKill Switchの基礎になる（後述）。
- **VPNトンネルのインターフェース名（`<vpn_iface>`）は動的に検出する。** ベンダー・バージョンにより `tun0`・`nordlynx` 等固定できないため、VPN接続完了後に `ip route show default` の出力インターフェースを取得し、それを用いてルールを再適用する。再接続・国変更のたびに旧ルールを撤去し、新インターフェース名で再適用する。
- `<lan_iface>`（LAN側インターフェース名）は、インストールスクリプト実行時に検出し設定ファイルへ書き出し、プロキシコンテナ起動時に環境変数/設定ファイル経由で読み込む（ハードコードしない）。

## Kill Switch

- ユーザ向け設定 `killSwitch` がONの場合: 上記 `forward` チェーンの `policy drop` をそのまま維持する。VPN接続が確立していない、または切断された場合、`<vpn_iface>` 宛のacceptルールが存在しない（または撤去済みの）状態になるため、LAN側からのフォワード通信は自動的に遮断される（フェイルクローズ）。VPN接続状態の監視により、切断を検知した時点で該当acceptルールを即座に撤去する。
- `killSwitch` がOFFの場合: VPN切断時に、LAN側からの通信をWAN側インターフェースへ直接acceptするフォールバックルールを追加し、フェイルオープンとする。
- `killSwitch` の切替はユーザ向け設定としてAPIサーバから通知され、プロキシコンテナがnftルールを再構成することで即時反映する。

# 明示的プロキシモードの実現方式

- SOCKS5とHTTP(CONNECT)の両方を単一プロダクトでサポートする必要があるため、**3proxy**（軽量Cバイナリ、SOCKS4/5・HTTP・HTTP CONNECTに対応）を採用する。SOCKS5専用のmicrosocksやHTTP専用のtinyproxy単体では要件を満たさない。
- 3proxyは自身でルーティングを制御せず、OSのルーティングテーブルに従って発信するだけである。プロキシコンテナのデフォルトルートがVPNベンダーCLIによってトンネル経由に切り替わっていれば、3proxy側は特別な設定なしに自動的にVPN越しの通信になる。透過ゲートウェイモードのnftables管理とは独立して機能する。
- `network_mode: host` を採用しているため、3proxyがLAN向けにbindするポート（例 SOCKS5:1080, HTTP:8080）はDockerのポートマッピングを介さずホストのLANインターフェースに直接listenできる。
- Node/TS側の責務:
  1. ユーザ向け設定（`explicitProxyEnabled`、`explicitProxyAllowedCidrs`等）変更時、3proxyの設定ファイルをテンプレートから生成する。
  2. `child_process.spawn` で3proxyを起動・監視し、異常終了時は再起動する。
  3. VPN接続状態の変化に伴う3proxyの再起動は不要（ルーティングに自動追従するため）。設定変更（ポート変更等）時のみ再起動する。

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

# VPNベンダーCLIの追加方法

1. プロキシコンテナのDockerイメージに新規ベンダーCLIバイナリを同梱する。
2. 管理者向け設定（VPNクライアント操作プロファイルJSON、apiserver/design.md参照）に新規ベンダーのエントリを追加する。
3. プロキシ側の実行可能バイナリ許可リストに新規バイナリのパスを追加する。

# 障害時の挙動

- VPN接続断検知時: 監視プロセスが `ip route show default` 等でトンネル経路の消失を検知し、Kill Switch設定に従ってnftablesルールを即座に更新する（上記「Kill Switch」節参照）。
- 3proxyプロセスの異常終了: 監視プロセスが検知し再起動する。連続的なクラッシュループの場合は再起動間隔を指数バックオフし、APIサーバへエラー状態を通知する。
- プロキシコンテナ自体の再起動時: `restart: always` により自動再起動されるが、起動時にnftablesルールの残骸（前回異常終了時のもの）が残っていないか確認し、一度全て撤去してから再適用する。

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
      - ./config/proxy-network.env:/etc/vpngwgui/network.env:ro  # インストール時検出したLANインターフェース名等
    restart: always

volumes:
  ctl-socket:
```
