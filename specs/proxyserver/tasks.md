# 実装タスク

Phase分けは`wbs/`配下の各`phaseN.md`を参照。本ファイルのタスクは最終形（Phase 2以降）を含めた全体像であり、Phase 1では下記「モックVPN CLI (Phase 1)」節と「内部コマンド受信サーバ」節のみを対象とする。実VPNベンダーCLIへの置換はネットワーク基盤移行より前のPhase 2で行う（`wbs/README.md`「フェーズ分割の考え方」参照）。

## プロジェクトセットアップ

- [x] Node.js/TSプロジェクト初期化
- [x] Dockerfile作成（Phase 1: モックCLI同梱。Phase 2でVPNベンダーCLIバイナリに、Phase 4で3proxy同梱に置換）
- [x] docker-compose設定（Phase 1: 通常のDockerブリッジネットワーク＋`ctl-socket`ボリューム。Phase 2で`cap_add: [NET_ADMIN]`・`devices`を追加、Phase 3で`network_mode: host`に変更）
- [x] API・プロキシ両コンテナの同一UID/GID起動設定

## モックVPN CLI (Phase 1)

- [x] `proxy/mock-cli/adguardvpn-cli-mock.mjs` 作成（`connection -l/-d/-s`応答、エラー注入用`zz`国コード対応）
- [x] Dockerfileへのモックスクリプト同梱・実行権限付与
- [x] 実行可能バイナリ許可リストへのモックスクリプトパス登録

## 内部コマンド受信サーバ（UDS制御チャネル）

- [x] `http` 組み込みモジュールによるUDS listenサーバ実装
- [x] 起動時の残存ソケットファイル `unlink` 処理
- [x] `listen` 後の `chmodSync(0o770)` によるパーミッション制限実装
- [x] 実行可能バイナリ許可リストによる `binary` 照合・拒否処理実装
- [x] `execFile` によるコマンド実行実装（`timeoutMs` 対応、シェル不使用）
- [x] レスポンス（`exitCode`/`stdout`/`stderr`）実装
- [x] リクエスト/レスポンスのランタイムスキーマ検証実装（受信リクエストの最小形状チェックのみ。TypeBox/zod等によるスキーマ定義までは行っていない）
- [x] 実行要求・結果の構造化ログ記録実装

## 実VPNベンダーCLI統合・ログイン代行 (Phase 2)

- [x] 実VPNベンダーCLIバイナリのDockerイメージ同梱（モックCLIスクリプトから置換）
- [x] `cap_add: [NET_ADMIN]`・`devices: [/dev/net/tun]`の付与（`network_mode: host`への移行前だが、コンテナ自身のnetns内で完結するため付与可能。詳細はproxyserver/design.md「Phase 1における縮小構成」参照）
- [x] 実行可能バイナリ許可リストのモックCLIパスから実CLIパスへの置換
- [x] （apiserver側）stdout/stderrパーサーの実CLI用差し替え、`POST /v1/session`（ログイン代行）実装
- [x] 内部コマンド受信サーバへの`completionPattern`対応追加（`runDetachableCommand`、長時間プロセスの早期応答・バックグラウンド継続実行）
- [x] 実機（対象ホスト・実VPN接続）での`connect`動作確認（2026-09-14実施。`adguardvpn-cli connect -l jp -y`でTOKYOへ接続し外部IPが`156.146.34.246`に変化することを確認、`disconnect`で復帰も確認。詳細はwbs/phase2.md「次フェーズへの申し送り」参照）
- [x] Web UI経由（未ログイン→URL表示→ブラウザ認証→状態反映、接続/切断/国変更、504タイムアウト）のE2E確認（2026-09-14実施。詳細はwbs/phase2.md「次フェーズへの申し送り」参照）
- [x] ログイン代行バックグラウンドプロセスが認証完了後もCPUを消費し続ける不具合の修正（stdinを`"pipe"`化、`backgroundTimeoutMs`による安全装置追加。`command-runner.ts`・`command-runner.test.ts`参照）
- [x] ログイン情報永続化がコンテナ再作成で失われる不具合の修正（原因はDockerブリッジネットワークのIPv6非透過。`network_mode: host`への移行をPhase3から前倒し。`docker-compose.yml`・`docker-entrypoint.sh`参照）

## 透過ゲートウェイモード (Phase 3以降)

- [ ] IPフォワーディングの起動時チェック・フォールバック設定実装
- [ ] `nft` コマンドによる専用テーブル（`inet vpngwgui`）管理実装（postrouting/forwardチェーン）
- [ ] VPNトンネルインターフェース名の動的検出処理（`ip route show default`）
- [ ] 再接続・国変更時のルール撤去・再適用処理実装
- [ ] コンテナ起動時の残骸ルール全撤去・再適用処理実装

## Kill Switch (Phase 3以降)

- [ ] `killSwitch` ON時の `forward` チェーン `policy drop` 維持・acceptルール管理実装
- [ ] VPN切断検知時のacceptルール即時撤去処理実装
- [ ] `killSwitch` OFF時のフェイルオープン用フォールバックルール実装
- [ ] ユーザ向け設定変更通知受信によるnftables即時再構成実装

## 明示的プロキシモード (Phase 4以降)

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

## インストールスクリプト (Phase 3以降)

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
