# Phase 10: Proton VPN対応

**【2026-09-21追加】実施順は Phase 11 の直後・Phase 6 の前（`1 → 2 → 3 → 5 → 8 → 4 → 9 → 11 → 10 → 6 → 7`）。** 当初はPhase 9の直後だったが、Web UIからのベンダー選択の要望（`phase11.md`）により、Proton VPNを「ベンダーごとに別のproxyコンテナ」ではなく**ランナーコンテナ（`runner-protonvpn`）**として追加する形へ改訂し、Phase 11の後に実施する。フェーズ番号は識別子であり実施順ではない（`README.md`参照）。

## 目的

Proton VPN（公式Linux CLI `proton-vpn-cli`）をVPNプロバイダとして利用できるようにする。無料版の制限（接続先を選べず、最速の無料サーバへの自動接続のみ）は、Phase 9で作った実行可否（capability）の仕組みでWeb UIへ反映する。

## 前提

- Phase 9完了（プロバイダ抽象化基盤・モックプロバイダCLIでの検証）。
- **Phase 11完了**（ネットワークコンテナとランナーの分離、Web UIからのベンダー選択）。本フェーズは、その上にProton VPNのランナーとプロファイルを追加する。
- 検証環境（`ubuntu@192.168.3.240`）に`proton-vpn-cli` 1.0.3をインストール済み（2026-09-21。`~/claude-installed.md`に記録。ホストへは依存パッケージ（NetworkManager・gnome-keyring等、約250）も導入された。検証環境の実機では、NetworkManagerはネットワークを管理しない（全て`unmanaged`）ことを確認済み）。
- Proton VPNの**無料アカウント**（利用者が人手でログインする。認証情報は検証環境へ複製せず、Web UIのログインフォームから入力する）。有料アカウントは無いため、有料版の挙動（`connect --country`・`countries list`）は実機未検証となる。

## 調査で判明した事項（2026-09-21、公式CLI 1.0.3のソース・検証環境での実行）

- コマンド: `signin <ユーザー名>`・`signout`・`info`・`connect [--country|--city|<サーバID>|--p2p|--securecore|--tor|--random]`・`disconnect`・`status`・`countries list`・`cities list <国>`・`config list`・`config set <項目> <値>`。`--verbose`。終了コード: 使い方の誤り・プラン制限は2、その他の失敗は1。
- **ログインは対話入力**: `signin`は`getpass`でパスワードを、2FAが必要なときのみ続けて`2FA Token:`を読む。ブラウザ認証のURL提示は無い。
- **無料版は`connect`の引数指定が全て不可**（国・都市・サーバID・機能・`--random`は`... is not available on the free plan`で失敗（終了コード2）。引数なしの`connect`のみ最速の無料サーバへ接続）。
- **無料版の判定に使える読み取り専用コマンド**: `config list`。未ログインは`Authentication required`（終了コード2）、無料版は有料機能が`Upgrade to enable`＋末尾に`To upgrade to VPN Plus`。`status`は未ログインでも`Status: Disconnected`（終了コード0）を返すため、ログイン判定には使えない。
- 出力: `status`＝`Status: Connected`／`Server: <名> in <都市>, <国>`／`Load: N%`／`Protocol: <名>`、`connect`＝`Connected to <名> in <都市>, <国>.`＋`Your new IP address is <IP>.`、`countries list`＝`tabulate`のsimple形式（`Country`／`Code`）。ping値付きの一覧は無い。
- **実行環境の制約**: NetworkManager・gnome-keyring（Secret Service）・`proton-vpn-daemon`・セッションD-Busに依存し、公式に「headless非対応」。GUIアプリと同時に動かせない。分割トンネリングは未対応。CLIのKill Switch（`config set kill-switch`）は本システムのKill Switchと競合しうる。

## PoC途中の知見（2026-09-21。Phase 11の設計変更により中断。次の点は実機・実イメージで確認済み）

- **`proton-vpn-daemon`は分割トンネリング用のD-Bus活性化サービス（`me.proton.vpn.split_tunneling`）で、接続・ログインには不要**。CLIはaptの依存でこれを要求するが、コンテナ内で起動する必要は無い（設計の「daemon起動」は不要。`specs/proxyserver/design.md`は本フェーズで訂正する）。接続の実体は`python3-proton-vpn-api-core`のNetworkManagerバックエンド（`proton/vpn/backend/networkmanager`）で、Kill Switchの別実装（`firewall_kill_switch`・D-Bus`me.proton.vpn.kill_switch`）は既定で無効。
- **Ubuntu 24.04のイメージへ`apt-get install proton-vpn-cli`する際の落とし穴**: (1)リリースパッケージ`protonvpn-stable-release`は`gnupg`・`apt-transport-https`に依存する。(2)`proton-vpn-daemon`のpostinstがsystemd無しでも`systemctl daemon-reload/enable/start`を無条件に実行し、`systemctl`が失敗してdpkgが失敗する。`/usr/local/bin/systemctl`に何もしないスタブを置く方法は**効かなかった**（dpkgのmaintainerスクリプトで実際の`/usr/bin/systemctl`が呼ばれた。原因未特定）。対処案: `/usr/bin/systemctl`自体を導入中だけスタブへ差し替える、または`dpkg-divert`、または`proton-vpn-daemon`を導入せず`dpkg --force-depends`で`proton-vpn-cli`だけ入れる。(3)`network-manager`のpostinstは`file`コマンド不在の警告を出すが無害。
- NetworkManagerの設定（WireGuard以外を`unmanaged`）は、ホスト側で`nmcli device status`が全デバイス`unmanaged`となる挙動を確認済み（検証環境にNMがインストール済みで、`systemd-networkd`管理のNICを奪わない）。コンテナ内での挙動（`network_mode: host`）は未検証。
- 検証環境（`192.168.3.240`）のホストには`proton-vpn-cli`・NetworkManager・`proton-vpn-daemon`等が導入済み（`~/claude-installed.md`）。コンテナ内NMとホストのNMを同時に動かすと競合するため、PoC時はホストのNMを停止する。

## スコープ外

- 都市指定（`--city`）・P2P・Secure Core・Tor・サーバID指定・`--random`（有料機能。接続先は国単位のみ）。
- Proton VPN側の機能設定（NetShield・ポートフォワーディング等。`config set`のUI化）。
- Proton VPN CLIによる分割トンネリング（公式に未対応。`excludedDomains`はPhase 6）。
- 複数ベンダーの同時接続（接続は常に1ベンダー。Web UIで切り替える。`phase11.md`）。

## 決定事項（利用者への確認結果、2026-09-21）

| 項目 | 決定 |
|---|---|
| 実行基盤 | ランナーコンテナ内同梱（`proxy/Dockerfile.runner-protonvpn`）。**先行PoCで合否を判定**し、不合格ならホスト導入＋D-Bus共有へ切り替える |
| ログイン方式 | Web UIのフォーム入力（Phase 9で汎用実装済み） |
| UI制限の表示 | 無効化＋理由表示（Phase 9） |
| 検証アカウント | 無料アカウントを利用者が人手でログイン |

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件定義・設計・タスク一覧の作成（`specs/`各ファイル、本ファイル）。

### 1. 実行基盤のPoC（最初に実施。合否基準は`specs/proxyserver/design.md`「Proton VPN向けproxyイメージ」）
- [x] コンテナ内でNetworkManager・keyring・セッションD-Busが起動し（`proton-vpn-daemon`は起動不要）、`protonvpn status`が応答する。（2026-09-21、検証環境で確認。`Status: Disconnected`、終了コード0）
- [x] NetworkManagerがホストの既存インターフェースを変更しない設定（`unmanaged-devices=*,except:type:wireguard`）の確定。（コンテナ内`nmcli device status`で全デバイス`unmanaged`、ホストの`enp6s18`・docker・lxcのアドレス・経路に変化なし）
- [x] TTYの無いコンテナで、標準入力からのパスワード入力で`signin`が成立する。（2026-09-21、利用者がWeb UIのフォームから無料アカウントでログインし成功。`exec_completed`に`stdinProvided:true`のみが残り、パスワードはログ・応答に出ない。トークンはkeyringに保管され、**`docker compose up -d --force-recreate runner-protonvpn`後もログインが保持される**ことを確認）
- [x] `connect`でWireGuardインターフェースが作られ、`ip route get`がそれを指す。切断で戻る。（2026-09-21確認。`proton0`が作られ`ip route get 1.1.1.1`が`dev proton0`（ポリシールーティングのテーブル）を指す。切断でI/Fが消える。**実装中に3件の不具合を修正**: 下記「実機検証で判明した事項」）
- [x] 透過ゲートウェイ（nftables）がそのインターフェース経由でLAN端末の通信をVPNへ通す。（2026-09-21確認。nftに`proton0`向けのmasquerade/forwardが入り、LAN端末の出口IPがProton側になる。GW直接の出口IPとは異なる）
- [x] PoC結果に基づく合否判定: **ここまで合格**（コンテナ内実行基盤は成立。判定基準1・4と、2の一部）。残り（基準2の実ログイン、3、5）は無料アカウントでのログイン後に確認する。不合格に転じた場合は本フェーズの設計（`specs/runner/design.md`・本ファイル）を改訂する。

### 2. 実装
- [x] `proxy/Dockerfile.runner-protonvpn`・エントリポイント（`docker-entrypoint.protonvpn.sh`）・NM設定（`networkmanager-vpngwgui.conf`）・`docker-compose.yml`の`runner-protonvpn`サービス（`profiles: [protonvpn]`・ボリューム）。（イメージは約1GB。検証環境でビルド・起動し、APIから`GET /v1/providers`で利用可能と判定されることを確認）
- [x] ランナーの許可バイナリ`RUNNER_ALLOWED_BINARY=/usr/bin/protonvpn`をイメージへ焼き込み（Phase 11でプロキシの許可リストから置き換え）。
- [x] `api/config/profiles/protonvpn.json`（`specs/apiserver/design.md`「Phase 9における具体プロファイル」）。**実機で確認済み**: 未ログイン時の`config list`が`Authentication required`（終了コード2）→`notLoggedIn`／ログイン後の`config list`（`Upgrade to enable`・`To upgrade to VPN Plus`）で`plan: Free`と判定／`connect --country JP`が終了コード2・`Location selection is not available on the free plan...`（`restrictedPattern`と一致）／`connect`の出力`Connected to JP-FREE#3 in Osaka, Japan.`から`output.locationPattern`が接続先を取り出す／`status`の`Server:`行も同様。**追加した項目**: `disconnect.successPattern`（下記）。**設計判断**: 無料版でも`countries list`自体は成功する（国指定の接続だけが制限される）が、接続できない一覧は無意味なので、`locationList`も`plans[].restricts`に含めて理由付きで無効にしたまま維持する。
- [x] Proton VPN CLI既定のKill Switch設定の確認（本システムのKill Switchに一本化する）。（`config list`で`kill-switch off`が既定。offでも接続中はCLIが一時的にNM式Kill Switchを作るが、接続完了で自動的に消える）
- [ ] `changeLocation`（接続中の再接続）の可否の確認（有料版のみ検証可能。無料版では接続先を選べないため対象外。`features.changeLocation`の値は有料版の検証まで既定値のまま）。
- [x] Proton VPNの有効化手順（`install/select-providers.sh adguardvpn protonvpn`。`specs/design.md`・`e2e/README.md`）。検証環境では有効化済み（`.env`）。

### 3. 検証
- [x] 実機（検証環境・実LAN・Proton VPN無料アカウント）での手動検証（2026-09-21。自動化した`e2e/phase10/`は作らず、手順は下記「検証手法」に記録）: Web UIのフォームでログイン→プラン判定（Free）→接続先リストが理由付きで無効→自動接続（API `PUT /v1/connection {connect:true}`）→出口IPがProton側（GW: 190.2.151.158等）→LAN端末の出口IPもProton側→切断でトンネルI/F消滅・Kill Switch ONでLAN端末が遮断→接続中のAdGuardへの切替（自動切断、Protonのトンネル消滅）→Protonへ戻してもログイン保持→runner再作成後もログイン保持・再接続可。
- [ ] 有料版の挙動（国指定の接続・国一覧・接続先変更）は**検証待ち**として明記する（アカウント無し）。

## 完了基準

- 無料アカウントで、Web UIのみの操作（ログインフォーム→接続→切断→ログアウト）で完結すること。ログイン後、プランが「Free」と表示され、接続先リスト領域には無効の理由（無料プランでは接続先を選べない旨）が表示され、［接続］で最速の無料サーバへ接続できること。
- 接続中、出口IPがProton VPN側になり、LAN端末（透過ゲートウェイ）の通信もVPN経由になること。VPN切断・瞬断でKill Switchが本システムのnftablesで効くこと（Proton VPN CLI側のKill Switchは使わない）。
- proxyコンテナを再作成してもログインが保持されること。
- Web UIのベンダー選択でAdGuard VPNとProton VPNを切り替えられ、AdGuard VPNが従来どおり動くこと（Proton VPNの追加で既存機能を壊していない）。
- パスワード・2FAコードが、APIのレスポンス・各種ログ・画面のいずれにも現れないこと（実CLIでの確認）。

## 検証手法

- **PoC・実行基盤（実施済み）**: 検証環境（`192.168.3.240`）で`docker compose`（`COMPOSE_PROFILES=protonvpn`）により`runner-protonvpn`をビルド・起動し、コンテナ内で`nmcli device status`・`protonvpn status`・`protonvpn config list`・`secret-tool`（keyringの保存・取得・コンテナ再作成後の保持）を確認。あわせてAPI経由（`GET /v1/providers`・`PUT /v1/providers/active`・`GET /v1/session`・`GET /v1/connection/capabilities`・`POST /v1/session`）で実CLIの出力の解釈と、標準入力でのパスワード受け渡しを確認。
- **実機の手動検証（実施済み）**: 検証環境のWeb UI（`http://192.168.3.240:8080`）でProton VPNを選択し、利用者が無料アカウントでログイン。以降は`curl`（`/api/v1/...`）と`e2e/lxc/env.sh`のLAN端末（`lxc exec vpngw-lan curl https://api.ipify.org`）で、接続・出口IP・Kill Switch・切替・再作成後のログイン保持を確認した。ログアウトは、再ログインできるアカウント情報が手元に無いため実施していない（`signout`はCLIの標準機能でAPIの実装は単体テスト済み）。

## 次フェーズへの申し送り

- **状態: 検証完了（無料アカウントの範囲）**。有料版の挙動は未検証。検証環境ではProton VPNが有効で、ログイン済み（無料）。
- **実機検証で判明した事項（2026-09-21、利用者から「接続で`Connection failed`」と報告→調査・修正）**: PoCの設定のままではログイン後の接続が必ず失敗した。原因は3段あり、いずれもNM式のKill Switch・WireGuard接続の前提がコンテナ内で満たされていなかったこと。詳細は`specs/runner/design.md`「Proton VPN用ランナー」。
  1. **NMが「ユーザ限定」のプロファイルを有効化しない**: CLIの接続プロファイルは`permissions=user:vpngwgui`で、ログインセッションが無いと有効化されない（コンテナにlogindが無い）。→ エントリポイントで`/run/systemd/users`・`sessions`を偽装。
  2. **dummyデバイスが管理対象外**: Kill Switch用のdummyが`unmanaged`だと有効化されない。→ NM設定の例外に`type:dummy`を追加。
  3. **物理NICが管理対象外だとVPNサーバへ到達できない**: WireGuard接続はサーバ宛の経路をNMの管理下の物理NICへ足してKill Switch（default経路を握りつぶす）を迂回する。→ 上り側NIC（`LAN_IFACE`）を**NM起動時から**管理対象にして既存設定を引き継ぐ（起動後に切り替えるとIPが外れる）。`docker-compose.yml`のrunner-protonvpnへ`LAN_IFACE`を渡す。
  あわせて: (4)**CLIの`disconnect`は実接続を切断したときだけ終了コード1**を返す（メッセージは`Disconnected.`。未接続なら0）ため、アクションに`successPattern`（終了コードが0以外でも出力が一致すれば成功）を追加し、`PUT /v1/connection`と切替の切断で使う（`api/src/profile/command-success.ts`）。(5)コンテナ再作成で取り残される`proton0`・`ipv6leakintrf0`等を、エントリポイントの先頭で削除する。
- **未解明**: 切断直後の再接続が1回だけ`Connection failed`になった（同じ条件の再現は5回中0回。サーバ選択（JP-FREE#3の負荷90%）が原因の可能性。CLIのデバッグログ`PROTON_VPN_DEBUG=true`を残していなかった）。再発したら`PROTON_VPN_DEBUG=true`でCLIログ（`~/.cache/Proton/VPN/logs/vpn-cli.log`）を採る。
- **既知の制約**: NMが上り側NICを管理対象にするため、そのNICのRA由来のIPv6アドレスが入れ替わる（本システムはIPv4のみが対象）。Proton CLIの接続中はNM式Kill Switchが一時的にホストのdefault経路（metric 98）を握るため、接続の確立中（数秒）はホスト自身の外部通信も止まる。
- **判明した点（PoC）**: (1)**keyringは空のパスワードでは初回のログインkeyringを作成できない**（`org.gnome.keyring.SystemPrompter`のGUIプロンプトが要求され失敗する）。`gnome-keyring-daemon --login`にランダムなパスワードを標準入力で渡す（パスワードは`~/.config/Proton/.keyring-pass`へ0600で保存。暗号化としての強度は無い）。(2)`proton-vpn-daemon`のpostinstのsystemctl問題は、`/usr/bin/systemctl`を`dpkg-divert`で退避して導入中だけスタブに差し替える方法で解決した（`/usr/local/bin`へ置く方法は効かない）。(3)NM起動時に`systemctl daemon-reload`の失敗ログが出るが無害（systemd無し）。(4)`signin`失敗時の`stderr`に`getpass`のTTY無しの警告（`GetPassWarning`・`Password input may be echoed`）が含まれる（利用者向けの詳細に出るだけで、パスワードは含まれない）。(5)ホストのNetworkManagerはPoC中に停止・無効化した（コンテナ内NMと競合するため。`~/claude-installed.md`）。
- 有料版の挙動（国指定の接続・国一覧・接続先変更）は、アカウントが無いため検証待ち。
