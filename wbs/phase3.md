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
- [ ] `/etc/sysctl.d/99-vpngwgui.conf`（`net.ipv4.ip_forward=1`）作成＋`sysctl --system`実行スクリプト作成。
- [ ] LAN側インターフェース名の自動検出（デフォルトゲートウェイの逆引き等）＋`network.env`書き出し処理。
- [ ] proxyコンテナ起動時、`/proc/sys/net/ipv4/ip_forward`が0であれば1に補正するフォールバック処理（インストールスクリプト未実行環境向け）。

### 透過ゲートウェイモード（nftables）
- [ ] `nft`コマンドラッパー実装（`iptables`は使わない。legacy/nftバックエンドの曖昧さ回避のため）。
- [ ] 専用テーブル`inet vpngwgui`の作成・postrouting/forwardチェーン構成。
- [ ] VPNトンネルインターフェース名の動的検出（`ip route show default`の出力解析。Phase2で統合済みの実CLIが確立する実インターフェースで検証する）。
- [ ] 再接続・国変更時の旧ルール撤去→新IFでの再適用処理。
- [ ] コンテナ起動時の残骸ルール全撤去→再適用処理（`restart: always`による再起動時の冪等性確保）。

### Kill Switch実処理
- [ ] `killSwitch=true`時の`forward`チェーン`policy drop`維持とacceptルール管理。
- [ ] VPN切断検知時のacceptルール即時撤去。
- [ ] `killSwitch=false`時のフェイルオープン用フォールバックルール。
- [ ] ユーザ向け設定変更（API→proxy）をnftables再構成へ即時反映する経路の実装（下記「内部プロトコル拡張」参照）。

### 内部プロトコル拡張
- [ ] proxyのUDSサーバに、Phase1で用意した`POST /exec`エンドポイントとは別に、設定反映専用の`POST /settings`（内部プロトコル、OpenAPI対象外）を追加する。APIサーバは`killSwitch`変更時にこのエンドポイントへ最新のユーザ向け設定全体を送信し、proxy側がnftables再構成を行う。
- [ ] APIサーバの`proxy-client.ts`に`notifySettings()`関数を追加（Phase1の`executeVendorCommand()`とは別関数として分離する）。

### VPN接続状態監視
- [ ] トンネル経路消失を検知する監視処理（`ip route show default`ポーリング等）とKill Switch/透過ゲートウェイ連携。

## 完了基準

- `docker compose up`後、LAN側の別端末（またはホストの別netnsを模したテスト環境）からこのホストをゲートウェイに設定し、Phase2で統合済みの実VPNベンダーCLIによるトンネル確立中はVPN経由の通信が成立し、`killSwitch=true`でトンネル切断時に通信が遮断されることを確認する。
- `killSwitch=false`に変更した状態でトンネルを切断し、直接インターネットに抜けることを確認する。
- proxyコンテナ再起動後、nftablesルールが重複・残骸なく再構成されることを確認する（`nft list ruleset`で確認）。

## 次フェーズへの申し送り

- （Phase2完了後に実装しながら追記する）
