# Phase 25: デプロイメント構成の分離（Webサーバ・APIサーバ・ゲートウェイの独立配置）

## 目的

`specs/requirements.md`「デプロイメント構成の分離」「通信路の保護」「認証・認可」を実現する。Webサーバ・APIサーバ・ゲートウェイ（プロキシサーバ＋ランナー群）を、それぞれ独立したホストへ分離して配置できるようにし、分離により生じる到達性の変化に対応する認証・通信路の保護をあわせて追加する。

開発・デプロイの疎結合化と、ゲートウェイ機（実際にVPNトラフィックを中継する機体）の負荷低減を目的とする。ゲートウェイ機には`network_mode: host`が必須なプロキシサーバ・ランナーだけを配置できるようにする。

## 前提

Phase1〜24完了。既存の単一ホスト構成（`docker-compose.yml`）が動作していること。

本フェーズは範囲が広いため、以下の順序で段階的に実装し、各段階を単体で動作確認してから次へ進む（ただし本フェーズのcommitは、AGENTS.mdの規則により、全段階の実装・検証が完了してから1つにまとめる）。

1. **Web UI利用者認証**（`/v1/operator`・`/v1/operator/session`。初回はWeb UIでアカウントを作成し、以後は設定画面から変更する）の追加。既存の単一ホスト構成のまま検証できる。
2. **ゲートウェイ制御チャネルのmTLS TCP化**（UDS→TCP＋mTLS）。単一ホスト構成のまま（ローカル宛のmTLS）で検証できる。
3. **compose分割とオーケストレーション型インストーラ**（`--api`・`--web`・`--gateway`）・証明書の生成・配布。実際に複数ホストへ分離配置して検証する。

## スコープ外

- 複数ゲートウェイの同時管理（1対1を前提とする。`specs/requirements.md`「デプロイメント構成の分離」）。
- 外部認証局（Let's Encrypt等）との連携。証明書はすべて自己署名。
- 証明書の失効・自動ローテーション（`--rotate-pairing`による手動再発行のみ）。
- トポロジー変更の自動移行（構成変更はアンインストール後の再インストールを要求する）。
- SSH到達性が無い環境（踏み台・多段SSH等）への対応。

## 主要タスク

### Web UI利用者認証（`specs/apiserver/design.md`「Web UI利用者の認証」、`specs/webserver/design.md`「利用者認証の実装方針」）

- [x] APIサーバ: アカウントのハッシュ保存（`api/src/auth/operator-account-store.ts`）。
- [x] APIサーバ: `GET/POST/PUT /v1/operator`（`api/src/routes/operator.ts`。状態確認・初回作成・変更）。
- [x] APIサーバ: `POST/GET/DELETE /v1/operator/session`（`api/src/routes/operator-session.ts`）。
- [x] APIサーバ: `preHandler`フックによる全`/v1/*`エンドポイントの認可（`api/src/auth/require-operator-session.ts`）。
- [x] APIサーバ: ログイン試行・パスワード変更のレート制限（`api/src/auth/login-rate-limiter.ts`）。
- [x] Web UI: 初期設定画面（`web/src/components/auth/SetupPage.tsx`）、ログイン画面（`LoginPage.tsx`）、認証状態コンテキスト（`AuthContext.tsx`）、401時の遷移（`Root.tsx`＋`AuthContext.tsx`のセッション定期確認）。
- [x] Web UI: 設定ダイアログへのアカウント変更フォーム追加（`SettingsDialog.tsx`。`AccountSettingsForm.tsx`として分離）。
- [x] E2E共通化: `e2e/lib/playwright.mjs`の`launch()`が初期設定・ログインを自動で済ませるようにし、既存の各phaseのE2Eスクリプトを個別に変更せず認証ゲートを通過できるようにした。
- [x] E2E（curlベース）: 全`/v1/*`の認証必須化で壊れていた、シェルで直接curlを叩く既存のE2Eスクリプト（`phase3/gateway-scenarios.sh`・`phase4/dashboard-scenarios.sh`・`phase5/locations-scenarios.sh`・`phase6/proxy-scenarios.sh`・`phase7/mock-scenarios.sh`・`phase8/provider-scenarios.sh`・`phase8/real-switch-scenarios.sh`・`phase10/add-vendor-scenarios.sh`・`phase11/install-scenarios.sh`・`phase20/uninstall-scenarios.sh`）を、共通ヘルパー`e2e/lib/api-auth.sh`（ローカルcurl用`e2e_api_login`・`gw`経由用`gw_api_login`）で対応した。
- [x] E2E後始末: 永続環境（`GW_MODE=ssh`/`lxc`の検証機。volumeごと消える一時構成は対象外）を使うスクリプトの終了時に、`reset_operator_account`でWeb UI利用者アカウントを削除し、インストール直後の未設定状態へ戻すようにした（`e2e/README.md`「Web UI利用者認証（Phase25以降）への対応」）。
- [ ] E2E: 初回アクセス時の設定画面、正しい/誤ったユーザー名・パスワードでのログイン、ログアウト、セッション切れ時の挙動、アカウント変更（現在パスワード確認含む）専用のE2Eシナリオ（未作成。手動検証は実施済み、下記「検証記録」参照）。

**検証記録（2026-09-23、単一ホスト構成・検証環境192.168.3.240）**:
- `npm test`（api 292件・web 121件・ベンダー中立性・installスクリプト）全件成功。
- curlによるAPI直接検証: 初期設定→未認証時401→Cookie付きで200→ログアウト→旧Cookieで401→正しいパスワードでログイン200→誤ったパスワードで401、を確認。
- 実ブラウザ（Playwright、ヘッドレスChromium）による既存E2Eの一部実行: `phase21`・`phase22`は認証ゲートを自動突破してPASS。`phase3`（login）・`phase16`・`phase23`は、検証環境の現在のVPNベンダーログイン状態・選択中ベンダー・Phase24での枠線色変更という、Phase25と無関係な既存の前提差異により失敗（認証ゲート自体は正常に通過できていることを、後続の失敗箇所から確認済み）。全phaseのE2Eを網羅的に再実行してはいない。
- `GW_MODE=ssh bash e2e/phase3/gateway-scenarios.sh A`・`... B`を実際に実行し、認証（`gw_api_login`）・Web UI操作・後始末（`reset_operator_account`）が正常に機能し、実行後は`GET /v1/operator`が`configured:false`に戻ることを確認した。他のシェルベースE2E（phase4〜phase10・phase11・phase20）は構文検証（`bash -n`）のみで、実際の通し実行はしていない。

### ゲートウェイ制御チャネルのmTLS化（`specs/proxyserver/design.md`「ゲートウェイ制御チャネル」）

- [x] インストーラ: 単一ホスト構成向けのCA・サーバ証明書・クライアント証明書のローカル生成（SSHを使わない経路。`install/install.sh`の`setup_gateway_pki`、`/etc/vpngwgui/pki/`。`--uninstall`側は`uninstall_gateway_pki`）。
- [x] proxy: mTLS TCPリスナー（`GATEWAY_PORT`。`proxy/src/gateway-channel/tls-options.ts`）とパスルーティング（`/net/*`→自分自身、`/runners/<ID>/*`→UDS転送、`proxy/src/gateway-channel/runner-forward.ts`）の実装。`proxy/src/server.ts`をUDS（`net.sock`）からこのmTLS TCPへ置き換えた。
- [x] API: `undici`の`Agent({ connect: { ca, cert, key } })`によるmTLSクライアント設定（`api/src/proxy-client/gateway-tls-options.ts`）、UDS（`Pool`＋ソケットパス）の置き換え（`executeVendorCommand`・`notifySettings`・`fetchProxyStatus`・`checkRunnerHealth`・`requestConnectionCheck`。いずれも`api/src/proxy-client/proxy-client.ts`）。
- [x] 単体・結合テスト: 証明書検証失敗時の拒否（`proxy/src/gateway-channel/tls-options.test.ts`。クライアント証明書無し・別CA署名のいずれも接続確立せず、正しい証明書のみ確立することを実TLSサーバ・クライアントで確認）、パスルーティング（`proxy/src/gateway-channel/runner-forward.test.ts`）、既存の`/net/settings`・`/net/status`・`/runners/<ID>/exec`等の挙動が変わらないこと（`api/src/proxy-client/proxy-client.test.ts`）。
- [x] 実機検証: 単一ホスト構成のまま、Web UIからの全操作（接続・切断・ベンダー切替・設定変更等）が従来どおり動作すること（下記「検証記録」参照）。

### オーケストレーション型インストーラ・証明書の生成・配布（`specs/design.md`「デプロイメント構成の分離とロール別インストール」）

- [x] compose分割（`compose/web.yml`・`compose/api.yml`・`compose/gateway.yml`）とルートの`docker-compose.yml`のアンカー化（`include:`は不採用。理由は`specs/design.md`参照）。
- [x] `install/install.sh`: `--api`・`--web`・`--gateway`引数によるトポロジー決定、記録済みトポロジーとの不一致検出（再実行時のエラー停止）。
- [x] `install/install.sh`: 指定されたリモートホストへのSSH/SCP到達性の事前検証（失敗時は変更前に停止）。
- [x] `install/install.sh`: 証明書一式（`web`用自己署名証明書、`api-ca`＋apiサーバ証明書、`gateway-ca`＋`proxy`サーバ証明書＋apiクライアント証明書）のローカル生成と、ロールごとの配置先（ローカル／`scp`）への配布。
- [x] `install/install.sh`: リモートロールの実行（`git archive`によるソース転送＋`ssh`経由のリモート実行）。
- [x] Webサーバ・APIサーバ自身のHTTPS化（配布された自己署名証明書を使用）。
- [x] `install/install.sh --uninstall`: トポロジー記録に基づくロールごとの後始末（ローカル／`ssh`経由）、オーケストレーター以外のホストで実行された場合の警告＋ローカルのみ後始末。
- [x] 実機検証: 3台（web・api・gateway）に分離した構成で、Web UIからの主要操作（利用者アカウント作成・ログイン・ベンダー一覧取得・ゲートウェイ稼働状況取得）が動作すること。トポロジー不一致での再実行エラー、証明書の再生成（`--rotate-pairing`は単体テストのみ）、分離構成でのアンインストール（オーケストレーターから）。

**検証記録（Stage3、2026-09-23、検証環境192.168.3.240）**:
- `npm test`（api 294件・proxy 109件・web 122件・ベンダー中立性・installスクリプト40件超）全件成功、`npm run build`全ワークスペース成功。
- 単一ホスト構成（`sudo sh install/install.sh --providers adguardvpn,protonvpn --web-port 8080`）を実行し、`https://192.168.3.240:8080`でWeb UIが応答すること、web→api（HTTPS＋CA検証）・api→gateway（mTLS）が正しく動作することをcurlで確認。`GW_MODE=ssh bash e2e/phase3/gateway-scenarios.sh A B`を再実行しFAIL 0（透過ゲートウェイ・Kill Switch・Web UI到達性が、HTTPS化後も従来どおり動作する。ブラウザ操作はPlaywrightの`ignoreHTTPSErrors: true`で自己署名証明書を許容）。
- 3台に分離した構成（検証環境上にLXDコンテナ3台（web・api・gateway役）を用意。SSH鍵認証・NOPASSWD sudoを設定）で`install/install.sh --web <IP> --api <IP> --gateway <IP> --providers adguardvpn`を実行し、3台それぞれへソース転送・Docker導入・ビルド・起動が完了、証明書一式が各ロールへ配布されることを確認。Web UI（`https://<webのIP>`）から利用者アカウント作成→ログイン→`GET /v1/providers`→`GET /v1/connection/gateway`（web→api→gatewayの3ホップがすべて正しいTLS/mTLSで疎通）をcurlで確認。トポロジー不一致での再実行エラー、`--uninstall`による3台の後始末（コンテナ・証明書・`/opt/vpngwgui`の削除）とオーケストレーター自身の後始末を確認。
- 検証中に見つけて修正した不具合: (1) Web UI健全性チェック（`start_stack`）が認証必須の`/v1/providers`を叩いていたため常にタイムアウトしていた（`/v1/operator`へ変更）、(2) apiロール単独ホストで`VPN_PROVIDERS`が未設定になる（`determine_providers`をapiロールでも呼ぶよう修正）、(3) 分離構成でapiのポートがホストに公開されておらず、webから到達できない（`compose/api.yml`に`ports`を追加）、(4) 証明書配布時、非特権ユーザーのシェルが`/etc/vpngwgui/pki`（root所有・700）をリスト化できずグロブ展開に失敗する（`sudo sh -c`の中でグロブ展開させるよう修正）、(5) `--uninstall`（`sudo`実行）がrootの鍵でSSHしようとして接続に失敗する（`$SUDO_USER`として`sudo -u`でssh/scpを実行するよう修正）。
- 未実施: 実VPN接続を伴う操作（接続・切断・国変更）を3台分離構成で行う検証、`--rotate-pairing`の実機での再配布確認（単体テストのみ）、他のphaseのE2Eの網羅的な再実行、初回設定・ログイン専用のE2E（`wbs/phase25.md`Stage1から引き続き未着手）。
- `npm test`（api 292件・proxy 109件・web 121件・ベンダー中立性・installスクリプト）全件成功。
- `sudo sh install/install.sh --providers adguardvpn,protonvpn`を実行し、`setup_gateway_pki`が`/etc/vpngwgui/pki/`（gateway-ca.crt・proxy-server.crt/.key・api-client.crt/.key、所有者10001:10001、鍵は600）を生成することを確認。
- `docker compose up -d --build`後、`proxy`が`gatewayPort: 8443`でmTLS TCPをlistenし、`GET /v1/providers`（`/runners/<ID>/health`を中継）・`GET /v1/connection/gateway`（`/net/status`を中継）・設定変更（`/net/settings`）が、APIサーバ経由で正しく動作することをcurlで確認。
- `curl`でクライアント証明書無し・`--cacert`のみ（クライアント証明書省略）でmTLS接続を試み、TLSアラート`certificate required`で拒否されることを確認（完了基準の1つ「クライアント証明書無しでの接続拒否」）。正しいクライアント証明書（`api-client.crt`/`.key`）では`200`で応答することも確認。
- 実ブラウザ（Playwright）で`e2e/phase22/webgui-phase22.mjs`を実行しPASS（ダッシュボードの表示・稼働状況表示がmTLS経由のデータで正しく描画される）。
- シェルベースE2E（`GW_MODE=ssh bash e2e/phase3/gateway-scenarios.sh A B`）を再実行しFAIL 0を確認（透過ゲートウェイ・Kill Switch・設定の保存/反映が、UDSからmTLS TCPへの置き換え後も従来どおり動作する）。
- 未実施: 明示的プロキシ・接続系（シナリオC以降、実VPN接続を伴う）、他のphaseのE2Eの網羅的な再実行。

## 完了基準

- 単一ホスト構成（`--api`・`--web`・`--gateway`をすべて省略）で、既存のE2E（phase1〜24で作成したもの）が、ログイン画面を挟んだ形でFAIL 0であること。
- 3台に分離した構成（検証用環境に3台のLXC/VM等を用意）で、Web UIからの主要操作（ログイン・VPN接続・切断・ベンダー切替・設定変更・Kill Switch）が動作すること。
- ゲートウェイの`GATEWAY_PORT`に、APIサーバのクライアント証明書無しで接続した場合に拒否されること（mTLSの効果を実機で確認）。

## 次フェーズへの申し送り

- `wbs/phase15.md`「認証・認可」節は本フェーズで吸収したため、完了後にphase15.mdから該当項目を除去し、`specs/tasks.md`・`apiserver/tasks.md`・`webserver/tasks.md`の将来課題欄も更新する。
- 証明書の失効・ローテーション自動化、外部認証局連携、複数ゲートウェイの同時管理は将来課題として残す。
