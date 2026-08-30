# 実装タスク

## プロジェクトセットアップ

- [ ] Node.js/TSプロジェクト初期化
- [ ] Dockerfile作成（VPNベンダーCLIバイナリ・3proxy同梱）
- [ ] docker-compose設定（`network_mode: host`、`cap_add: [NET_ADMIN]`、`devices`、`ctl-socket`ボリューム）
- [ ] API・プロキシ両コンテナの同一UID/GID起動設定

## 内部コマンド受信サーバ（UDS制御チャネル）

- [ ] `http` 組み込みモジュールによるUDS listenサーバ実装
- [ ] 起動時の残存ソケットファイル `unlink` 処理
- [ ] `listen` 後の `chmodSync(0o770)` によるパーミッション制限実装
- [ ] 実行可能バイナリ許可リストによる `binary` 照合・拒否処理実装
- [ ] `execFile` によるコマンド実行実装（`timeoutMs` 対応、シェル不使用）
- [ ] レスポンス（`exitCode`/`stdout`/`stderr`）実装
- [ ] リクエスト/レスポンスのランタイムスキーマ検証実装
- [ ] 実行要求・結果の構造化ログ記録実装

## 透過ゲートウェイモード

- [ ] IPフォワーディングの起動時チェック・フォールバック設定実装
- [ ] `nft` コマンドによる専用テーブル（`inet vpngwgui`）管理実装（postrouting/forwardチェーン）
- [ ] VPNトンネルインターフェース名の動的検出処理（`ip route show default`）
- [ ] 再接続・国変更時のルール撤去・再適用処理実装
- [ ] コンテナ起動時の残骸ルール全撤去・再適用処理実装

## Kill Switch

- [ ] `killSwitch` ON時の `forward` チェーン `policy drop` 維持・acceptルール管理実装
- [ ] VPN切断検知時のacceptルール即時撤去処理実装
- [ ] `killSwitch` OFF時のフェイルオープン用フォールバックルール実装
- [ ] ユーザ向け設定変更通知受信によるnftables即時再構成実装

## 明示的プロキシモード

- [ ] 3proxy設定ファイルのテンプレート作成
- [ ] ユーザ向け設定変更時の3proxy設定ファイル生成処理実装
- [ ] `child_process.spawn` による3proxy起動・監視・異常終了時再起動実装
- [ ] `explicitProxyEnabled` 切替による起動/停止実装
- [ ] `explicitProxyAllowedCidrs` の設定反映実装

## VPN接続状態監視

- [ ] 接続状態・トンネル経路消失の監視処理実装
- [ ] 切断検知トリガーとKill Switch/透過ゲートウェイ連携実装

## excludedDomains（split-tunnel除外）対応

- [ ] ドメイン単位除外のDNS解決・ルーティング反映方式の詳細設計
- [ ] 上記方式の実装（3proxy側／透過ゲートウェイ側それぞれ）

## インストールスクリプト

- [ ] `/etc/sysctl.d/99-vpngwgui.conf` 作成・`sysctl --system` 実行処理実装
- [ ] LANインターフェース名検出・設定ファイル（`network.env`等）書き出し処理実装
- [ ] ホスト→プロキシコンテナ経由の外部通信設定処理実装

## 障害対応

- [ ] 3proxyクラッシュループ時の指数バックオフ実装
- [ ] APIサーバへのエラー状態通知実装
- [ ] コンテナ再起動時のnftables残骸確認・撤去処理実装

## テスト

- [ ] nftablesルール適用/撤去の動作確認
- [ ] Kill Switch（ON/OFF双方）の動作確認
- [ ] UDS受信サーバの単体テスト（許可リスト外バイナリの拒否含む）
- [ ] 透過ゲートウェイ／明示的プロキシ双方のE2E疎通確認

# 将来課題

- IPv6対応（現行設計はIPv4のNAT/FORWARDのみを前提としている）。
- 複数VPNベンダー・複数トンネルの同時稼働可否。
- `excludedDomains` のDNS TTL追従の詳細実装。
