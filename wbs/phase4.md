# Phase 4: 明示的プロキシモード（3proxy）

## 目的

3proxyを用いたSOCKS5/HTTPプロキシモードを実装し、`explicitProxyEnabled`・`explicitProxyAllowedCidrs`のユーザ向け設定をproxyコンテナへ反映できるようにする。

## 前提

- Phase2完了（実VPNベンダーCLIによる接続・切断が動作確認済み）。
- Phase3完了（proxyコンテナが`network_mode: host`で稼働しており、LANインターフェースへ直接bindできる状態）。
- **【2026-09-21】Phase5（Web UI）はPhase4より前に実施する（`wbs/README.md`参照）。** 本フェーズ着手時点でダッシュボード・設定ダイアログ・`GET /v1/connection/gateway`・proxy `GET /status`が存在する前提とする。
- Phase3で追加した内部プロトコル`POST /settings`（設定反映エンドポイント）が利用可能であること。

## スコープ外

（なし。実VPNベンダーCLIへの置換はPhase2で完了済み）

## 主要タスク

- [ ] 3proxy設定ファイルのテンプレート作成（SOCKS5:1080, HTTP:8080相当）。
- [ ] `POST /settings`受信時、`explicitProxyAllowedCidrs`から3proxy設定ファイルを再生成する処理。
- [ ] `child_process.spawn`による3proxy起動・監視・異常終了時再起動（指数バックオフ）実装。
- [ ] `explicitProxyEnabled`切替による3proxyプロセスの起動/停止。
- [ ] VPN接続状態変化時は3proxyを再起動しない（ルーティングに自動追従するため。design.md記載の通り、独立して機能することを確認する）。
- [ ] `GET /status`（proxy内部）・`GET /v1/connection/gateway`（api）のレスポンスへ`explicitProxy`（有効/実稼働/クラッシュループ状態）を追加する（Phase5で用意した拡張余地を利用。`specs/apiserver/design.md`参照）。
- [ ] ダッシュボードの明示的プロキシ稼働状況欄・設定ダイアログの「未対応」暫定表示（Phase5で追加）を、実稼働状況表示へ置き換える。
- [ ] 3proxyクラッシュループ検知時のAPIサーバへのエラー状態通知（`GET /v1/connection`等のレスポンスに反映できるよう、proxy→api方向の状態通知経路を検討・実装）。

## 完了基準

- クライアント端末から本ホストのSOCKS5/HTTPポートへプロキシ設定し、`explicitProxyAllowedCidrs`に含まれるCIDRからのみ接続を許可、それ以外を拒否することを確認する。
- `explicitProxyEnabled=false`にするとプロセスが停止し、ポートが閉じることを確認する。
- 3proxyを強制終了（`kill`）した際、監視処理が自動再起動することを確認する。
- Phase3で検証したnftables連携と、実際のトンネルインターフェース名（Phase2で統合済みの実CLIが確立するもの）の下で3proxyが独立して問題なく動作することを確認する。

## 次フェーズへの申し送り

- （実装しながら追記する）
