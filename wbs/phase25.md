# Phase 25: デプロイメント構成の分離（Webサーバ・APIサーバ・ゲートウェイの独立配置）

## 目的

`specs/requirements.md`「デプロイメント構成の分離」「通信路の保護」「認証・認可」を実現する。Webサーバ・APIサーバ・ゲートウェイ（プロキシサーバ＋ランナー群）を、それぞれ独立したホストへ分離して配置できるようにし、分離により生じる到達性の変化に対応する認証・通信路の保護をあわせて追加する。

開発・デプロイの疎結合化と、ゲートウェイ機（実際にVPNトラフィックを中継する機体）の負荷低減を目的とする。ゲートウェイ機には`network_mode: host`が必須なプロキシサーバ・ランナーだけを配置できるようにする。

## 前提

Phase1〜24完了。既存の単一ホスト構成（`docker-compose.yml`）が動作していること。

本フェーズは範囲が広いため、以下の順序で段階的に実装し、各段階を単体で動作確認してから次へ進む（ただし本フェーズのcommitは、AGENTS.mdの規則により、全段階の実装・検証が完了してから1つにまとめる）。

1. **Web UI利用者認証**（`/v1/operator-session`）の追加。既存の単一ホスト構成のまま検証できる。
2. **ゲートウェイ制御チャネルのmTLS TCP化**（UDS→TCP＋mTLS）。単一ホスト構成のまま（ローカル宛のmTLS）で検証できる。
3. **compose分割とロール別インストーラ**（`--role`）・証明書ペアリング。実際に複数ホストへ分離配置して検証する。

## スコープ外

- 複数ゲートウェイの同時管理（1対1を前提とする。`specs/requirements.md`「デプロイメント構成の分離」）。
- 外部認証局（Let's Encrypt等）との連携。証明書はすべて自己署名。
- 証明書の失効・自動ローテーション（`--rotate-pairing`による手動再発行のみ）。
- Web UIからのパスワード変更機能（インストーラの再実行でのみ変更可能）。
- SSHが使えない環境（踏み台経由等）への対応。

## 主要タスク

### Web UI利用者認証（`specs/apiserver/design.md`「Web UI利用者の認証」、`specs/webserver/design.md`「利用者認証の実装方針」）

- [ ] APIサーバ: パスワードのハッシュ保存（`api/src/auth/password-store.ts`）、インストーラでの`--web-password`受け取りとハッシュ化。
- [ ] APIサーバ: `POST/GET/DELETE /v1/operator-session`（`api/src/routes/operator-session.ts`）。
- [ ] APIサーバ: `preHandler`フックによる全`/v1/*`エンドポイントの認可（`api/src/auth/require-operator-session.ts`）。
- [ ] APIサーバ: ログイン試行のレート制限（`api/src/auth/login-rate-limiter.ts`）。
- [ ] Web UI: ログイン画面（`web/src/components/auth/LoginPage.tsx`）、認証状態コンテキスト（`AuthContext.tsx`）、401時の遷移。
- [ ] E2E: 未ログイン時の画面遷移、正しい/誤ったパスワードでのログイン、ログアウト、セッション切れ時の挙動。

### ゲートウェイ制御チャネルのmTLS化（`specs/proxyserver/design.md`「ゲートウェイ制御チャネル」）

- [ ] インストーラ: `--role all`向けのCA・サーバ証明書・クライアント証明書のローカル生成（SSHを使わない経路）。
- [ ] proxy: mTLS TCPリスナー（`GATEWAY_PORT`）とパスルーティング（`/net/*`→自分自身、`/runners/<ID>/*`→UDS転送）の実装。
- [ ] API: `undici`のmTLSクライアント設定、UDSクライアントの置き換え（`executeVendorCommand`・`notifySettings`・`fetchProxyStatus`等）。
- [ ] 単体・結合テスト: 証明書検証失敗時の拒否、パスルーティング、既存の`/settings`・`/status`・`/exec`等の挙動が変わらないこと。
- [ ] 実機検証: 単一ホスト構成のまま、Web UIからの全操作（接続・切断・ベンダー切替・設定変更等）が従来どおり動作すること。

### ロール分離インストーラ・証明書ペアリング（`specs/design.md`「デプロイメント構成の分離とロール別インストール」）

- [ ] compose分割（`compose/web.yml`・`compose/api.yml`・`compose/gateway.yml`）とルートの`docker-compose.yml`のラッパー化。
- [ ] `install/install.sh`: `--role`引数、ロールごとの処理分岐。
- [ ] `install/gateway-issue-client-cert.sh`・`install/api-export-ca.sh`（SSH経由のペアリング補助スクリプト）。
- [ ] `install.sh --role api --gateway-ssh ...`・`install.sh --role web --api-ssh ...`の実装。
- [ ] Webサーバ・APIサーバ自身のHTTPS化（自己署名証明書）。
- [ ] 実機検証: 3台（web・api・gateway）に分離した構成で、Web UIからの全操作が動作すること。ペアリングのやり直し（`--rotate-pairing`）。

## 完了基準

- 単一ホスト構成（`--role all`）で、既存のE2E（phase1〜24で作成したもの）が、ログイン画面を挟んだ形でFAIL 0であること。
- 3台に分離した構成（検証用環境に3台のLXC/VM等を用意）で、Web UIからの主要操作（ログイン・VPN接続・切断・ベンダー切替・設定変更・Kill Switch）が動作すること。
- ゲートウェイの`GATEWAY_PORT`に、APIサーバのクライアント証明書無しで接続した場合に拒否されること（mTLSの効果を実機で確認）。

## 次フェーズへの申し送り

- `wbs/phase15.md`「認証・認可」節は本フェーズで吸収したため、完了後にphase15.mdから該当項目を除去し、`specs/tasks.md`・`apiserver/tasks.md`・`webserver/tasks.md`の将来課題欄も更新する。
- 証明書の失効・ローテーション自動化、外部認証局連携、複数ゲートウェイの同時管理は将来課題として残す。
