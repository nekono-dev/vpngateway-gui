# Phase 3: ネットワーク基盤移行＋透過ゲートウェイモード

## 目的

proxyコンテナを`network_mode: host`へ移行し、ホストのネットワーク名前空間上でVPNトンネル（tun/wg系インターフェース）とLAN側インターフェースの両方を扱えるようにした上で、透過ゲートウェイモード（LAN機器がこのホストをデフォルトゲートウェイにした場合のNAT/MASQUERADE転送）とKill Switchの実処理を実装する。

Phase2で実VPNベンダーCLIへの置換が完了しているため、本フェーズのVPNトンネルインターフェース名の動的検出やKill Switch連携は、モックの疑似的な値ではなく、実CLIが実際に確立するトンネル（`tun0`等、ベンダー・バージョン依存で名称が変わりうる）を用いて検証する。

## 前提

- Phase1完了（web/api/proxyのUDS経由コマンド実行パイプラインがモックCLIで検証済み）。
- Phase2完了（実VPNベンダーCLIによる接続・切断・状態取得・ログイン代行が動作確認済み）。
- インストールスクリプト（sysctl永続化・LANインターフェース検出）の実行対象ホスト環境（Debian/RaspberryPiOS, Ubuntu 24.04）が用意できていること。

**【2026-09-14追記】`network_mode: host`への移行はPhase2で前倒し実施済み。** 当初は本フェーズでまとめて行う予定だったが、Phase2の実機検証でDockerブリッジネットワークがIPv6を透過せず実CLIのログインセッションが再作成のたびに失効する不具合が発覚し、その解決策が`network_mode: host`への切替のみだったため、この部分だけ前倒しした（`docker-compose.yml`・`wbs/phase2.md`「次フェーズへの申し送り」参照）。本フェーズの主要タスクのうち「ネットワーク基盤移行」冒頭の`network_mode: host`変更・UDS疎通確認は完了済みとして扱う。

## スコープ外

- 明示的プロキシモード（3proxy）は次フェーズ（phase4.md）。

## 主要タスク

### ネットワーク基盤移行
- [x] proxyサービスの`docker-compose.yml`定義を`network_mode: host`に変更し、`networks:`定義を除去（併用不可のため）。`cap_add: [NET_ADMIN]`、`devices: ["/dev/net/tun:/dev/net/tun"]`はPhase2で付与済みのため変更不要。（2026-09-14、Phase2で前倒し実施。上記「前提」参照）
- [x] host化に伴うUDS疎通の再確認（ctl-socketボリュームはネットワークモードに依存しないため影響なしのはずだが、実機で確認する）。（2026-09-14、Phase2での前倒し実施時に実機で確認済み。`GET/PUT /v1/connection`等API経由の一連の操作が正常動作することを確認）

### インストールスクリプト（最小限のホスト変更）
- [x] `/etc/sysctl.d/99-vpngwgui.conf`（`net.ipv4.ip_forward=1`）作成＋`sysctl --system`実行スクリプト作成。（`install/setup-sysctl.sh`）
- [x] LAN側インターフェース名の自動検出（デフォルトゲートウェイの逆引き等）＋`network.env`書き出し処理。（`install/detect-lan-interface.sh`。実装時、書き出し先をコンテナへの直接マウント用ファイルではなくリポジトリルートの`.env`（docker composeのvariable substitution用）に変更した。下記「次フェーズへの申し送り」参照）
- [x] proxyコンテナ起動時、`/proc/sys/net/ipv4/ip_forward`が0であれば1に補正するフォールバック処理（インストールスクリプト未実行環境向け）。（`proxy/src/network/ip-forward.ts`）

### 透過ゲートウェイモード（nftables）
- [x] `nft`コマンドラッパー実装（`iptables`は使わない。legacy/nftバックエンドの曖昧さ回避のため）。（`proxy/src/network/nft-client.ts`）
- [x] 専用テーブル`inet vpngwgui`の作成・postrouting/forwardチェーン構成。（`proxy/src/network/ruleset.ts`）
- [x] VPNトンネルインターフェース名の動的検出（`ip route show default`の出力解析。Phase2で統合済みの実CLIが確立する実インターフェースで検証する）。（`proxy/src/network/tunnel-interface.ts`。実機検証で、実CLIがポリシールーティング方式のため`ip route show default`では検知できないと判明し、`ip route get 1.1.1.1`方式に変更した。下記「実機検証で発見・修正した不具合」参照）
- [x] 再接続・国変更時の旧ルール撤去→新IFでの再適用処理。（`/exec`完了直後に`checkConnectionOnce()`で即時再評価。`proxy/src/server.ts`）
- [x] コンテナ再起動時のルール冪等性確保。（当初は起動時に全撤去→再適用としたが、実機検証でKill Switchのリークが判明したため、起動時は撤去せず最初の`POST /settings`受信時に全撤去→再適用する方式へ変更。下記「実機検証で発見・修正した不具合」参照）

### Kill Switch実処理
- [x] `killSwitch=true`時の`forward`チェーン末尾のLAN発drop維持とacceptルール管理。（当初は`policy drop`だったが、実機検証で同居コンテナの通信まで遮断すると判明したため`policy accept`＋LAN発dropへ変更。下記「実機検証で発見・修正した不具合」6参照）
- [x] VPN切断検知時のacceptルール即時撤去。
- [x] `killSwitch=false`時のフェイルオープン用フォールバックルール。
- [x] ユーザ向け設定変更（API→proxy）をnftables再構成へ即時反映する経路の実装（下記「内部プロトコル拡張」参照）。

### 内部プロトコル拡張
- [x] proxyのUDSサーバに、Phase1で用意した`POST /exec`エンドポイントとは別に、設定反映専用の`POST /settings`（内部プロトコル、OpenAPI対象外）を追加する。APIサーバは設定変更のたびにこのエンドポイントへ最新のユーザ向け設定全体を送信し、proxy側がnftables再構成を行う（当初想定は`killSwitch`変更時のみだったが、`transparentGatewayEnabled`も同じnftables再構成を要するため、全フィールド更新時に送信する方式に変更した。apiserver/design.md「設定反映（`POST /settings`）内部プロトコル仕様」参照）。
- [x] APIサーバの`proxy-client.ts`に`notifySettings()`関数を追加（Phase1の`executeVendorCommand()`とは別関数として分離する）。

### VPN接続状態監視
- [x] トンネル経路消失を検知する監視処理（`ip route show default`ポーリング等）とKill Switch/透過ゲートウェイ連携。（10秒間隔。`proxy/src/network/connection-monitor.ts`。`ip route show default`ではなく`ip route get 1.1.1.1`で判定する）

## 完了基準（**検証完了**。2026-09-21、LXC検証環境および実機（Ubuntu 24.04・単一NIC・実LAN）＋実VPN（AdGuard VPN CLI）で確認。手順・結果は下記「検証手法」「検証結果」参照）

- [x] `docker compose up`後、LAN側の別端末から本ホストをゲートウェイに設定し、Phase2で統合済みの実VPNベンダーCLIによるトンネル確立中はVPN経由の通信が成立し、`killSwitch=true`でトンネル切断時に通信が遮断されることを確認する。
- [x] `killSwitch=false`に変更した状態でトンネルを切断し、直接インターネットに抜けることを確認する。
- [x] proxyコンテナ再起動後、nftablesルールが重複・残骸なく再構成されることを確認する（`nft list ruleset`で確認）。

## 検証手法

各フェーズの完了判定は、実機（またはそれに準ずる実環境）でのE2E検証で行い、その手順をリポジトリの`e2e/`配下にスクリプトとして残す（詳細は`e2e/README.md`）。Web UIの操作はPlaywrightで行い、通信結果はLAN端末役からのcurl/tracerouteで確認する。Phase3の検証環境と手順:

- 検証環境: 検証ホストが`/dev/kvm`を持たずLXDのVM（QEMU）が使えないため、`security.nesting=true`のLXCシステムコンテナ2台を用いた。ゲートウェイ役（`vpngw-gw`。Docker・nftables・tunを持ち、`docker compose`でweb/api/proxyを実行。proxyは`network_mode: host`＝このコンテナのネットワーク名前空間）、LAN端末役（`vpngw-client`。デフォルトゲートウェイをゲートウェイ役へ向ける）。同一ブリッジ（lxdbr0）上に置き、ゲートウェイ役の単一NIC（eth0）をLAN側・フェイルオープン時の送出側に兼用する、対象ターゲット（単一NIC構成）と同じ形にしている。
- 構築: `sh e2e/lxc/setup.sh`（コンテナ作成・Docker導入・LAN端末のGW設定）→ ゲートウェイ役で`install/detect-lan-interface.sh`・`install/setup-sysctl.sh`を実行 → `sh e2e/lxc/sync.sh`（リポジトリ転送・`docker compose build/up`）。
- 実VPNへのログイン: Web UIの「VPNベンダーへログイン」ボタン（`e2e/phase3/webgui-login.mjs`）で認証URLを取得し、人手でブラウザ認証する（認証情報は検証環境へ複製せず、Phase2と同じ導線を用いた）。
- 自動検証: `bash e2e/phase3/gateway-scenarios.sh [A〜H]`。A=静的前提、B=VPN不要（透過GW ON/OFF・Kill Switch ON/OFF）、C=実VPN（接続・切断・瞬断・国変更・Web UI到達性）、D=再起動・冪等性、E=同居Dockerコンテナへの影響、F=IPv6リークの実測、G=上流断（実機のみ）、H=ホスト再起動（実機のみ）。Web UI操作は`webgui-settings.mjs`（設定ダイアログ）・`webgui-connection.mjs`（接続/切断）。
- **実機での検証（2026-09-21追加）**: `GW_MODE=ssh bash e2e/lxc/setup.sh`・`sync.sh`（資材はscp転送）で、SSH先の実機（Ubuntu 24.04.2・単一NIC `enp6s18`・実LAN 192.168.3.0/24・ルータあり・IPv6 RAあり）をゲートウェイにした。LAN端末役は開発ホスト上のmacvlan LXCコンテナ（実LANのIPv4/IPv6アドレスを持つ）で、デフォルトゲートウェイを実機に向ける。実機ではインストールスクリプト（`detect-lan-interface.sh`・`setup-sysctl.sh`・`setup-boot-guard.sh`）を実際に実行した。

## 検証結果（2026-09-21）

上記シナリオA〜Dの全項目がPASS（初回は下記の不具合により失敗し、修正後に通しで再実行して全PASS）。主な観測結果:

- 接続前: LAN端末の外部IP = 検証ホストのIP（212.102.42.196）。接続後（JP）: 156.146.34.246、国変更（DE）: 169.150.209.169。`ip route get`は`dev tun0 table 880`、nftには`oifname "tun0" masquerade`と`iifname "eth0" oifname "tun0" accept`が動的に入り、切断で即時撤去される。
- `killSwitch=true`: 切断（`disconnect`）・瞬断（VPNデーモンkill＋tun削除。10秒周期の監視で検知）のいずれでもLAN端末の外部通信が遮断される。`killSwitch=false`: 切断状態でGW経由で直接インターネットへ抜ける（tracerouteの1ホップ目がGW）。
- 再構成後もテーブルは1つで、混入した残骸ルールは最初の設定受信時に掃除される。proxyの非rootユーザーからの`sudo nft`・`ip`実行も確認した。

### 実機（単一NIC・実LAN）での結果（2026-09-21）

シナリオA〜Hの93項目が全てPASS（FAIL 0）。LXC検証環境でも同じルールセットでA〜Eが全てPASS。

- インストールスクリプトを実機で実行し、`.env`の`LAN_IFACE=enp6s18`検出、`ip_forward` 0→1の永続化、起動ガードの有効化を確認した。
- 単一NICのフェイルオープン（GWがLAN機器の通信を同一NICからルータへ再送）が実LANで成立し、tracerouteの1ホップ目がGWになる。
- 上流断（GWの物理NICからのインターネット向け送信を遮断して模擬）の間、LAN端末の通信は実IPへリークせず、復旧後はVPN CLIが**自動的に再接続**した。
- ホスト再起動: `restart: always`でweb/api/proxyが自動復帰し、KS ONで遮断状態に戻る。起動ガード導入前は再起動中に実IPリークを観測（3サンプル）、導入後は0。
- 同居Dockerコンテナ（`curlimages/curl`）は、KS ON・VPN未接続でもLAN端末が遮断される一方でインターネット通信を継続でき、VPN接続中も正常。
- IPv6: LAN端末のIPv6（RA由来の実アドレス）は、IPv4が遮断／VPN経由の状態でもGWを経由せずルータ直で外部へ出る（既知の制約として文書化。下記）。

## 実機検証で発見・修正した不具合

単体テスト（スタブ）だけでは検出できなかった、実環境固有の問題4件（うち3件は修正済みの実装欠陥、1件は検証環境側の問題）。

1. **【修正済み】透過ゲートウェイ有効化でWeb UIにLANから到達できなくなる。** `forward`チェーンの`policy drop`が、Dockerの公開ポート（web 8080→DNAT→ブリッジ上のコンテナ）宛の転送まで遮断していた。設定を戻す手段（Web UI）も失うため実害が大きい。`ct status dnat accept`を常に許可する1行を追加して解消（`proxy/src/network/ruleset.ts`）。ゲートウェイ転送通信はDNATされないためKill Switchの遮断範囲は変わらない。
2. **【修正済み】実VPN CLIの接続を検知できない（Phase 3の検出方式が前提から誤り）。** AdGuard VPN CLI（TUNモード）はメインテーブルのデフォルトルートを書き換えず、ポリシールーティング（`ip rule`優先度30801でテーブル880を参照）で全通信をトンネルへ向ける。このため`ip route show default`は接続後も`dev eth0`のままで、透過GW/Kill Switchが常に「VPN未接続」と判定していた。`ip route get 1.1.1.1`（ポリシールーティングを含むカーネルの実際の経路選択結果）へ変更して解消（`proxy/src/network/tunnel-interface.ts`）。default置換型のベンダーにも同方式で対応できる。
3. **【修正済み】proxyのみの再起動でKill Switchが効かずリークする。** 起動時に既存ルールを撤去し、設定はAPIからの`POST /settings`でしか受け取らないため、proxy単体の再起動後は次の設定変更までルールが無いままとなり、KS ONでもLAN端末が実IPで通信できていた（実測: 外部IPが212.102.42.196）。対応: (a) proxyは起動時にルールを撤去しない、(b) APIが設定を10秒周期で再通知する（`api/src/server.ts`）。
4. **【修正済み】`ip_forward`補正フォールバックが機能せず、失敗も無音。** Dockerはコンテナの`/proc/sys`を読み取り専用でマウントするため`tee`が`Read-only file system`で失敗する。フォールバックとしては機能しないと設計書へ明記し、補正できない場合は監査ログへ`ip_forward_disabled`を記録するようにした。実質的な解決手段は`install/setup-sysctl.sh`のみ。

5. **【修正済み・実機再起動で発覚】ホスト再起動中にKill Switchがリークする。** `ip_forward=1`は起動直後から有効なのに、nftテーブルはDocker→proxy→APIの通知を経て初めて作られるため、その間LAN機器の通信がVPNを迂回した（3サンプルで実IPを観測）。`install/setup-boot-guard.sh`（systemd oneshot、`network-pre.target`・`docker.service`より前）で、起動直後に同名テーブルへLAN発forwardのdropを載せ、proxyが最初の設定受信時に原子的に置換する方式で解消（再起動後の実IPリーク観測0）。
6. **【修正済み】Kill Switchの遮断が同居Dockerコンテナの通信にも及ぶ。** `forward`を`policy drop`にしていたため。`policy accept`＋末尾の`iifname "<lan_iface>" drop`（LAN側から入る転送のみ遮断）に変更し、単一NICで同居コンテナ通信の応答がLAN側NICから入る点を`oifname != <lan> ct direction reply ct state established,related accept`で救済した。
7. **【修正済み】`command-runner.test.ts`の間欠失敗（約1/12）。** 原因は実装のレース: `runDetachableCommand`の`exit`ハンドラだけが、`runCommand`にある「直前のstdout取りこぼし防止の猶予」を持たず、出力直後に終了するプロセスで`exit`が`data`より先に処理され、`completionPattern`に一致する出力を取りこぼしていた。猶予を追加し、25回連続で成功を確認した。
8. **【修正済み】`docker-compose.yml`に`restart:`ポリシーが無かった。** 設計書の`restart: always`前提と乖離していたため、web/api/proxyへ追加した（実機の再起動で自動復帰を確認）。

また検証環境側の落とし穴として、LAN端末のDHCPリース更新でデフォルトゲートウェイが再追加されGWを迂回したまま検証が進んでしまう問題があった（`e2e/lxc/setup.sh`でDHCPのゲートウェイ取得を無効化し、`gateway-scenarios.sh`冒頭で経路を保証するようにした）。

## 次フェーズへの申し送り

- **【解消】** 完了基準の実機検証（LXC環境・実機の両方）、`restart:`ポリシー、同居Dockerコンテナへの影響、`command-runner.test.ts`の不安定さ、起動時のKill Switchリーク。
- **IPv6は対象外（既知の制約・文書化済み）。** 透過ゲートウェイはIPv4のみを扱う。LAN機器がルータのRAでIPv6のデフォルトGWを得ていると、その通信はGWを経由せずVPN・Kill Switchを迂回する（実機で実測）。運用側でルータのIPv6 RA配布停止／LAN機器のIPv6無効化を行うこと（`specs/proxyserver/design.md`「Kill Switch」参照）。
- **プロキシコンテナは現在の`killSwitch`/`transparentGatewayEnabled`を自身では永続化しない。** APIの10秒周期再通知・起動時に撤去しない方針・起動ガードにより、proxy単体再起動・ホスト再起動のいずれでもフェイルクローズが維持されることを実機で確認した。ただしAPIの設定が「透過GW無効」の場合、起動ガードのテーブルは最初の設定受信までLAN発forwardを止める（数秒〜十数秒。透過GWを使わないホストなら影響なし）。
- **Kill Switch OFF時のフェイルオープン用「WAN側インターフェース」を、LAN側インターフェースと同一（`WAN_IFACE`省略時は`LAN_IFACE`を流用）という単純化を採用した。** 単一NIC構成は実機で確認済み。複数NIC構成（WAN/LAN分離）は未検証。`forward`の`oifname != <lan_iface> ct direction reply ...`許可や、VPN判定（`ip route get`）の前提が複数NICで成り立つかも併せて要確認。
- **VPN接続状態の判定は`ip route get 1.1.1.1`の出力インターフェースが`LAN_IFACE`と異なるかのみで行う。** ベンダーを問わず汎用（default置換型・ポリシールーティング型の両方）。複数NIC構成でVPN以外の理由により経路が変化するケースは誤判定しうる。
- **単一NICのフェイルオープンでは、ゲートウェイがLAN機器の通信を同一NICからルータへ再送する（ヘアピン）。** ルータがその再送を許容し、ICMPリダイレクトで機器が直接ルータへ向かうことが無い前提で成立する。実機（本検証のルータ）では成立した。ルータ次第では成立しない可能性がある。
- **物理的なネットワーク瞬断（ケーブル抜き等）は実施していない。** 上流断は「GWの物理NICからの送信を遮断」で模擬した。
- **`e2e/`配下の検証スクリプトは再実行可能**（`e2e/README.md`）。proxy/api/nft/install関連の変更時は、単体テストに加えて本シナリオの再実行を推奨する。
- `excludedDomains`（split-tunnel除外）はPhase3のスコープ外のまま（`specs/proxyserver/tasks.md`「将来課題」・`wbs/README.md`のフェーズ一覧よりPhase6予定）。
