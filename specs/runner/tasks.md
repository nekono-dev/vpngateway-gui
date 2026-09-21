# 実装タスク

ランナーコンテナ（`runner-<ベンダー>`）のタスク。Phase 11より前は、ネットワークコンテナ（`proxy`。../proxyserver/tasks.md）と同居していたため、当時のタスク（モックCLI・内部コマンド受信サーバ・実VPNベンダーCLI統合）もここへ移した。以降の「proxy」は当時のコンテナ名で、現在のランナー実装は`proxy/`パッケージ内の`src/runner.ts`・`src/exec/`・`src/allowlist.ts`にある。

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

## プロバイダ抽象化・複数プロバイダ対応（Phase 9・10）

（Phase 9の`EXTRA_ALLOWED_BINARIES`・`Dockerfile.adguardvpn`・`VPN_PROVIDER`によるproxyイメージの切替は、Phase 11で下記のランナー構成へ置き換えた。）

- [x] （Phase 9）`POST /exec`の`stdin`対応（`runCommand`・入力検証・4096バイト上限・ログへ内容を出さない）と単体テスト
- [x] （Phase 9）`EXTRA_ALLOWED_BINARIES`（E2E専用の追加許可バイナリ）と単体テスト
- [x] （Phase 9）モックプロバイダCLI（`proxy/mock-cli/protonvpn-mock.mjs`。公式CLI 1.0.3のソースに基づく出力・終了コードで、無料/有料・ログイン状態を模擬）と`docker-compose.e2e-mock.yml`
- [x] （Phase 9）`proxy/Dockerfile`を`proxy/Dockerfile.adguardvpn`へ改名し、`docker-compose.yml`を`VPN_PROVIDER`で切り替え可能にする
- [x] （Phase 10）Proton VPN用ランナーのPoC（合否基準はdesign.md「Proton VPN用ランナー」）。基準1・4と2の一部まで合格（実ログインが必要な基準2の残り・3・5は検証待ち。2026-09-21）
- [x] （Phase 10）`proxy/Dockerfile.runner-protonvpn`・エントリポイント・NM設定・`docker-compose.yml`の`runner-protonvpn`サービス・`RUNNER_ALLOWED_BINARY=/usr/bin/protonvpn`
- [x] （Phase 10）実機検証（人手ログイン。透過ゲートウェイ・Kill Switch・コンテナ再起動後のログイン保持。有料版は未検証。`wbs/phase10.md`）

## ランナーの分離（Phase 11）

- [x] `proxy/src/runner.ts`（ランナー: `POST /exec`・`GET /health`。許可バイナリは`RUNNER_ALLOWED_BINARY`の1つのみ）と、`exec/exec-handler.ts`・UDS待受・JSON入出力・監査ログの共有モジュール化（`lib/`）。単体テスト（`allowlist.test.ts`・`exec/exec-handler.test.ts`）
- [x] `EXTRA_ALLOWED_BINARIES`の廃止と`RUNNER_ALLOWED_BINARY`への置換
- [x] `proxy/Dockerfile.runner-adguardvpn`（従来のAdGuard用から分離。`RUNNER_ALLOWED_BINARY`を焼き込み）・`Dockerfile.runner-mock`（E2E専用）のビルド確認
- [x] `docker-compose.yml`の`runner-adguardvpn`サービス、`docker-compose.e2e-mock.yml`の`runner-mock`サービス（`profiles`・ボリューム・ソケット名）
- [x] 実VPN（AdGuard）で、ランナー分離後も接続・切断・ログイン・接続先一覧が従来どおり動くことの確認（`e2e/phase8`のリグレッション）
- [x] 各ランナーが自ベンダーのバイナリ以外を`403`で拒否することの、実コンテナでの確認（`e2e/phase11/provider-scenarios.sh`。2026-09-21）

## ベンダーバンドル化（Phase 12）

- [x] `vendors/<ID>/`へ移動: `Dockerfile`・`entrypoint.sh`・付属の設定（NM設定）・`compose.yml`（`runner-<ID>`・ボリューム。`profiles`廃止）・`profile.json`
- [x] E2E用モックベンダーをバンドル化（`e2e/vendors/mockproton/`。Dockerfile・compose・モックCLI・プロファイル）
- [x] `proxy/`直下のベンダー別ファイル・`proxy/mock-cli/`の整理、ランナーの実行部（`runner.ts`等）のコメント・メッセージの中立化
- [x] `docker-compose.yml`本体から`runner-*`・ベンダー別ボリュームを除去し、`COMPOSE_FILE`合成で起動できることの確認（`docker compose config`）

# 将来課題

- ベンダーの追加（NordVPN CLI等）: ランナー（イメージ・composeサービス・ボリューム）とプロファイルの追加（design.md「VPNベンダーCLI（ランナー）の追加方法」）。
- 複数ベンダーの同時接続（../requirements.mdで対象外。要求されれば経路・NAT・Kill Switchの再設計が必要）。
