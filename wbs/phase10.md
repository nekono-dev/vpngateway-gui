# Phase 10: Proton VPN対応

**【2026-09-21追加】実施順は Phase 9 の直後・Phase 6 の前（`1 → 2 → 3 → 5 → 8 → 4 → 9 → 10 → 6 → 7`）。** フェーズ番号は識別子であり実施順ではない（`README.md`参照）。

## 目的

Proton VPN（公式Linux CLI `proton-vpn-cli`）をVPNプロバイダとして利用できるようにする。無料版の制限（接続先を選べず、最速の無料サーバへの自動接続のみ）は、Phase 9で作った実行可否（capability）の仕組みでWeb UIへ反映する。

## 前提

- Phase 9完了（プロバイダ抽象化基盤・モックプロバイダCLIでの検証）。
- 検証環境（`ubuntu@192.168.3.240`）に`proton-vpn-cli` 1.0.3をインストール済み（2026-09-21。`~/claude-installed.md`に記録。ホストへは依存パッケージ（NetworkManager・gnome-keyring等、約250）も導入された。検証環境の実機では、NetworkManagerはネットワークを管理しない（全て`unmanaged`）ことを確認済み）。
- Proton VPNの**無料アカウント**（利用者が人手でログインする。認証情報は検証環境へ複製せず、Web UIのログインフォームから入力する）。有料アカウントは無いため、有料版の挙動（`connect --country`・`countries list`）は実機未検証となる。

## 調査で判明した事項（2026-09-21、公式CLI 1.0.3のソース・検証環境での実行）

- コマンド: `signin <ユーザー名>`・`signout`・`info`・`connect [--country|--city|<サーバID>|--p2p|--securecore|--tor|--random]`・`disconnect`・`status`・`countries list`・`cities list <国>`・`config list`・`config set <項目> <値>`。`--verbose`。終了コード: 使い方の誤り・プラン制限は2、その他の失敗は1。
- **ログインは対話入力**: `signin`は`getpass`でパスワードを、2FAが必要なときのみ続けて`2FA Token:`を読む。ブラウザ認証のURL提示は無い。
- **無料版は`connect`の引数指定が全て不可**（国・都市・サーバID・機能・`--random`は`... is not available on the free plan`で失敗（終了コード2）。引数なしの`connect`のみ最速の無料サーバへ接続）。
- **無料版の判定に使える読み取り専用コマンド**: `config list`。未ログインは`Authentication required`（終了コード2）、無料版は有料機能が`Upgrade to enable`＋末尾に`To upgrade to VPN Plus`。`status`は未ログインでも`Status: Disconnected`（終了コード0）を返すため、ログイン判定には使えない。
- 出力: `status`＝`Status: Connected`／`Server: <名> in <都市>, <国>`／`Load: N%`／`Protocol: <名>`、`connect`＝`Connected to <名> in <都市>, <国>.`＋`Your new IP address is <IP>.`、`countries list`＝`tabulate`のsimple形式（`Country`／`Code`）。ping値付きの一覧は無い。
- **実行環境の制約**: NetworkManager・gnome-keyring（Secret Service）・`proton-vpn-daemon`・セッションD-Busに依存し、公式に「headless非対応」。GUIアプリと同時に動かせない。分割トンネリングは未対応。CLIのKill Switch（`config set kill-switch`）は本システムのKill Switchと競合しうる。

## スコープ外

- 都市指定（`--city`）・P2P・Secure Core・Tor・サーバID指定・`--random`（有料機能。接続先は国単位のみ）。
- Proton VPN側の機能設定（NetShield・ポートフォワーディング等。`config set`のUI化）。
- Proton VPN CLIによる分割トンネリング（公式に未対応。`excludedDomains`はPhase 6）。
- 複数プロバイダの同時稼働（ベンダーは1台につき1種類）。

## 決定事項（利用者への確認結果、2026-09-21）

| 項目 | 決定 |
|---|---|
| 実行基盤 | コンテナ内同梱（`proxy/Dockerfile.protonvpn`）。**先行PoCで合否を判定**し、不合格ならホスト導入＋D-Bus共有へ切り替える |
| ログイン方式 | Web UIのフォーム入力（Phase 9で汎用実装済み） |
| UI制限の表示 | 無効化＋理由表示（Phase 9） |
| 検証アカウント | 無料アカウントを利用者が人手でログイン |

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件定義・設計・タスク一覧の作成（`specs/`各ファイル、本ファイル）。

### 1. 実行基盤のPoC（最初に実施。合否基準は`specs/proxyserver/design.md`「Proton VPN向けproxyイメージ」）
- [ ] コンテナ内でNetworkManager・`proton-vpn-daemon`・keyring・セッションD-Busが起動し、`protonvpn status`が応答する。
- [ ] NetworkManagerがホストの既存インターフェースを変更しない設定（`unmanaged-devices`）の確定。
- [ ] TTYの無いコンテナで、標準入力からのパスワード入力で`signin`が成立する（人手：無料アカウント）。ログイン情報がコンテナ再作成後も保持される。
- [ ] `connect`でWireGuardインターフェースが作られ、`ip route get`がそれを指す。切断で戻る。
- [ ] 透過ゲートウェイ（nftables）がそのインターフェース経由でLAN端末の通信をVPNへ通す。
- [ ] PoC結果に基づく合否判定。**不合格の場合は本フェーズの設計（`specs/proxyserver/design.md`・本ファイル）を改訂してから先へ進む**。

### 2. 実装
- [ ] `proxy/Dockerfile.protonvpn`・エントリポイント・`docker-compose.protonvpn.yml`（ボリューム・`!reset`でAdGuard用の定義を除去）。
- [ ] プロキシの許可リストへ`/usr/bin/protonvpn`を追加。
- [ ] `api/config/profiles/protonvpn.json`（`specs/apiserver/design.md`「Phase 9における具体プロファイル」）。実機の出力に合わせて`restrictedPattern`・`output.locationPattern`・`account.plans[].pattern`を確定する。
- [ ] Proton VPN CLI既定のKill Switch設定の確認（本システムのKill Switchに一本化する。有効になっていた場合の扱い）。
- [ ] `changeLocation`（接続中の再接続）の可否の確認（有料版のみ検証可能。無料版では接続先を選べないため対象外。`features.changeLocation`の値は有料版の検証まで既定値のまま）。
- [ ] `install/`または文書へ、プロバイダ選択（`.env`の`VPN_PROVIDER`・`COMPOSE_FILE`）の手順を追記。

### 3. 検証
- [ ] 実機（検証環境・実LAN・Proton VPN無料アカウント）でのE2E（`e2e/phase10/`）: Web UIのフォームでログイン→プラン判定（Free）→接続先リストが理由付きで無効→自動接続→出口IPがProton側→LAN端末の透過ゲートウェイ通信→Kill Switch→切断→ログアウト→コンテナ再起動後もログイン保持。
- [ ] 有料版の挙動（国指定の接続・国一覧・接続先変更）は**検証待ち**として明記する（アカウント無し）。

## 完了基準

- 無料アカウントで、Web UIのみの操作（ログインフォーム→接続→切断→ログアウト）で完結すること。ログイン後、プランが「Free」と表示され、接続先リスト領域には無効の理由（無料プランでは接続先を選べない旨）が表示され、［接続］で最速の無料サーバへ接続できること。
- 接続中、出口IPがProton VPN側になり、LAN端末（透過ゲートウェイ）の通信もVPN経由になること。VPN切断・瞬断でKill Switchが本システムのnftablesで効くこと（Proton VPN CLI側のKill Switchは使わない）。
- proxyコンテナを再作成してもログインが保持されること。
- AdGuard VPNプロバイダ（`VPN_PROVIDER=adguardvpn`）が従来どおり動くこと（プロバイダ切替で既存機能を壊していない）。
- パスワード・2FAコードが、APIのレスポンス・各種ログ・画面のいずれにも現れないこと（実CLIでの確認）。

## 検証手法

（実施後に記載する。）

## 次フェーズへの申し送り

- （実装しながら追記する）
