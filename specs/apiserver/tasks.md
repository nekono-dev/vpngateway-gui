# 実装タスク

# Phase 1スコープについて

本ファイルのタスクはPhase 1（`wbs/phase1.md`）ではモックVPN CLI（proxyserver）を対象に実装する。`PUT /v1/connection/config`で受理する`killSwitch`等の設定値は、Phase 1では永続化のみ行い、プロキシ側への実反映（nftables操作等）はPhase 3以降（`wbs/phase3.md`）で行う。

## プロジェクトセットアップ

- [x] Fastify + TypeBox + `@fastify/swagger` によるプロジェクト初期化
- [x] Dockerfile作成（APIコンテナ）
- [x] lint / test 基盤の整備（2026-09-14: ESLint（`typescript-eslint`のrecommended構成）を導入し`npm run lint`を追加。テストは下記各項目参照）

## 管理者向け設定（VPNクライアント操作プロファイル）

- [x] プロファイルJSONのTypeBoxスキーマ定義
- [x] プロファイル読み込み処理（`:ro` マウント想定）の実装
- [x] プレースホルダー検証ロジック（正規表現・`enumFrom`）の実装

## ユーザ向け設定

- [x] ユーザ向け設定の永続化実装（設定ファイルまたはSQLite等の軽量DB）（Phase1は単一JSONファイル）
- [x] `GET /v1/connection/config` 実装
- [x] `PUT /v1/connection/config` 実装
- [x] `excludedDomains` 等の形式検証実装

## 接続制御API

- [x] `GET /v1/connection` 実装
- [x] `PUT /v1/connection` 実装（`connect`/`country` 検証・コマンド解決・UDS送信）
- [x] `GET /v1/connection/countries` 実装（**Phase 5で`GET /v1/connection/locations`へ置換**）

## 接続先（ロケーション）API (Phase 5)

`wbs/phase5.md`。設計は`design.md`「接続先（ロケーション）」。

- [x] プロファイル: `listLocations`アクション追加、`countries`・`enumFrom`方式の廃止、`%LOCATION%`（`source: "locations"`）の動的な許可値検証（`profile.schema.ts`・`placeholder-resolver.ts`・`api/config/vpn-profile.json`）
- [x] `list-locations`出力パーサー・接続先ID・接続時指定名（`(Virtual)`除去）（`locations/location-list-parser.ts`・`locations/location-id.ts`・`lib/slugify.ts`）
- [x] お気に入りストア・最後の接続先ストア（`locations/favorite-locations-store.ts`・`locations/last-location-store.ts`）
- [x] `GET /v1/connection/locations`（ping昇順・`favorite`・`lastConnected`付き）。`GET /v1/connection/countries`を廃止
- [x] `PUT`/`DELETE /v1/connection/locations/{locationId}/favorite`
- [x] `PUT /v1/connection`を`locationId`指定へ変更（接続時に`listLocations`を再実行して`id`を解決、成功時に最後の接続先・接続状態を保存）。`GET /v1/connection`に`locationId`を含める
- [x] 設定スキーマから`defaultCountry`を除去（既存設定ファイルの残存値を無視）
- [x] スキーマ検証エラーを400で返す（`app.ts`）
- [x] テスト（パーサー・ストア・各エンドポイント・プレースホルダー）

## ログイン代行API

- [x] `POST /v1/session` 実装（`login` アクション解決・実行結果からログインURL抽出）（Phase2で実装、`wbs/phase2.md`参照）

## 稼働状況取得API (Phase 4)

- [x] `proxy-client.ts`に`fetchProxyStatus()`追加（ExecResult同様、TypeBoxで応答形状を検証。2026-09-21）
- [x] `GET /v1/connection/gateway` 実装（TypeBoxスキーマ・OpenAPI公開。`routes/connection-gateway.ts`・`schemas/gateway.ts`。2026-09-21）
- [x] 上記の統合テスト（プロキシ疎通はモック化。200/502/504。`routes/connection-gateway.test.ts`・`proxy-client.test.ts`。2026-09-21）
- [x] 稼働状況へ`explicitProxy`（`state`: active/stopped/unconfigured/crashLoop/error、`socksPort`/`httpPort`/`restartCount`）を追加（Phase 6。`schemas/gateway.ts`。2026-09-21）
- [x] `explicitProxyAllowedCidrs`のIPv4 CIDR形式検証（不正は400で保存しない。3proxy設定ファイルへの行注入対策。`settings/settings-store.ts`・`lib/ipv4-cidr.ts`。Phase 6。2026-09-21）

## 監査ログ

- [x] コマンド実行要求・結果の構造化ログ記録実装
- [x] `GET /v1/connection/log` 実装

## プロキシサーバとの内部通信

- [x] UDSクライアント実装（`undici`の`Pool("http://localhost", {socketPath})`を使用。design.md記載の`Agent({socketPath})`と同等の目的を満たす）
- [x] 内部プロトコルのランタイムスキーマ検証実装（TypeBox）（2026-09-14: `proxy-client.ts`にExecResultのTypeBoxスキーマ検証を追加、期待と異なる形状の応答は例外を投げるよう変更。プロキシ側の受信リクエストは既に検証済み）
- [x] UDS未応答・タイムアウト時のハンドリング実装

## エラーハンドリング

- [x] 入力エラー（`400`）のハンドリング実装
- [x] プロキシ接続失敗（`502`）のハンドリング実装
- [x] プロキシ実行失敗（`422`、`exitCode`/`stderr`要約含む）のハンドリング実装
- [x] 接続先国の永続化（接続成功時に要求した国＋接続先の都市名を保存し、`GET /v1/connection`・`PUT`の応答へ`country`/`location`を付与、切断・接続先不一致で消去。`connection-state/connection-state-store.ts`。2026-09-21。Web UI再読み込みで接続国が消える不具合の修正）
- [x] 422の`stderr`が空の場合はstdoutを診断として返す（実CLI `adguardvpn-cli`はエラーをstdoutへ出力するため。Phase 4のE2Eで判明。`lib/failure-output.ts`。2026-09-21）
- [x] タイムアウト（`504`）のハンドリング実装（2026-09-14: 実機で`proxy`コンテナを`docker compose pause`により意図的に無応答化し、`GET /v1/connection`が`504 {"error":"proxy_timeout",...}`を返すことをE2Eで確認済み。`wbs/phase2.md`参照）

## OpenAPI公開

- [x] `/openapi.json` 公開設定
- [x] orvalによるWeb側クライアント生成の疎通確認

## テスト

- [x] プレースホルダー検証ロジックのユニットテスト（`profile/placeholder-resolver.test.ts`）
- [x] APIエンドポイントの統合テスト（プロキシ疎通はモック化）（`routes/session.test.ts`で`POST /v1/session`の200/422/502/504を検証。他エンドポイントは未着手）

## プロバイダ抽象化・プラン制限（Phase 7）

- [x] プロファイルスキーマ拡張（`loginMethod`・`output.locationPattern`・`features`・省略可アクション・`connectAuto`・`logout`・`account`・`restrictedPattern`・`table`・`connectNameFrom`・`source: "input"`）と、必須アクションの組合せ検証（`profile/profile.schema.ts`・`profile-loader.ts`）
- [x] プロファイルを`api/config/profiles/<プロバイダ>.json`へ移動し、`docker-compose.yml`の参照を`VPN_PROVIDER`で切り替える
- [x] オペレーションの語彙・実行可否の評価（`capabilities/`。原因の優先順・依存継承）と単体テスト
- [x] `account`判定（`session/session-probe.ts`。30秒キャッシュ・同時要求の集約・失敗非キャッシュ）と単体テスト
- [x] 実行失敗からの学習（`capabilities/restriction-learner.ts`。`restrictedPattern`一致→`403 operation_restricted`）と単体テスト
- [x] `GET /v1/connection/capabilities`
- [x] `GET /v1/session`・`DELETE /v1/session`、`POST /v1/session`の`credentials`方式（入力検証・stdin受け渡し・秘密の伏字化・監査ログに秘密を残さない）と統合テスト
- [x] `PUT /v1/connection`の`connectAuto`対応（`locationId`省略時）、`501`（未対応操作）
- [x] `location-list-parser`の汎用化（列名のプロファイル指定・区切り行の読み飛ばし・`city`なし・`connectNameFrom`）と単体テスト
- [x] 接続状態のテキスト出力解釈のプロファイル化（`output.locationPattern`）と単体テスト
- [x] `lib/redact.ts`（秘密の伏字化。汎用ヘルパー）と単体テスト
- [x] AdGuard VPNプロファイルへ`account`（`license`）と`logout`を追加（PREMIUM・未ログインの出力は実機で確認。**無料版の出力（`using the FREE version`）は未確認**。2026-09-21）

## ベンダーの選択（Phase 8）

- [x] 複数プロファイルの読み込み・検証（`providers/provider-registry.ts`。`ENABLED_PROVIDERS`・`VPN_PROFILES_DIR`・ファイル名＝ベンダーID・`displayName`。従来の`VPN_PROFILE_PATH`の廃止）
- [x] 選択中のベンダーの永続化（`providers/active-provider-store.ts`）
- [x] ベンダー別の状態（`providers/provider-state-paths.ts`。接続状態・最後の接続先・お気に入りを`providers/<ID>/`へ。旧形式からの移行）と、ログイン状態キャッシュ・学習した制限のベンダー別化
- [x] `proxy-client`のベンダー別ランナー宛（`runner-<ID>.sock`）・ネットワークコンテナ宛（`net.sock`）への分離、ランナーの`GET /health`による利用可否
- [x] `GET /v1/providers`・`PUT /v1/providers/active`（切替の手順・競合の直列化・`409`/`422`/`502`）と統合テスト
- [x] 接続・切断・ログアウト・切替後のネットワークコンテナへの`POST /connection-checks`通知
- [x] 監査ログへのベンダーID（`provider`）の付与
- [x] 既存の各ルートを選択中のベンダー対象へ改修（単体・統合テスト: api 214件。実VPNで旧形式の状態の移行・ログイン保持・既存E2Eを確認。2026-09-21）

## プランで接続できる接続先の参考一覧（Phase 12）

- [x] プロファイルスキーマ（`account.plans[].availableLocations`）と読み込み時の検証
- [x] `plan-locations.ts`（宣言に従った抽出・置き場の外の拒否・空の一覧へのフォールバック）と単体テスト
- [x] `GET /v1/connection/available-locations`と統合テスト（無料/有料/未ログイン・ファイル無し）
- [x] `docker-compose.yml`の`api`へキャッシュボリュームの読み取り専用マウントと`PROVIDER_CACHE_DIR`
- [x] Proton VPNプロファイルへの宣言の追加

## プランの補足情報の参考表示（Phase 13、検証完了）

- [x] `profile.schema.ts`の`PlanDefSchema`へ`usageNote`（`{ pattern: string }`、省略可）を追加
- [x] `session-probe.ts`の`evaluateAccountOutput`で、確定したプランの`usageNote.pattern`を出力に対して評価し、一致すれば`SessionInfo.plan.usageNote`へキャプチャを設定
- [x] `schemas/session.ts`（`SessionStateSchema`）・`routes/session.ts`（`GET /v1/session`）へ`plan.usageNote`を反映
- [x] `vendors/adguardvpn/profile.json`の`free`プランへ`usageNote.pattern`を追加（実機確認済みの出力形式に基づく。`wbs/phase13.md`「次フェーズへの申し送り」参照）
- [x] `vendors/adguardvpn/samples.json`へ無料版の実出力サンプル（`license`のFREE版出力）を追加。`list-locations`の10件・`connect`失敗（一覧外指定）のサンプルは、`vendor-samples.test.ts`が扱う`kind`（`status`/`listLocations`/`account`）に対応する検証手段が無く、`connect`失敗は`restrictedPattern`として宣言しない方針（`specs/apiserver/design.md`「検討し、採用しなかった案」）のためコードからも参照されないので追加しなかった。
- [x] 単体テスト: `session-probe.test.ts`（`usageNote`の抽出・不一致時の省略）、`profile-loader.test.ts`（不正な`usageNote.pattern`の拒否）、`vendor-samples.test.ts`（AdGuard VPNの無料版サンプル）

## ベンダー非依存化（Phase 10）

- [x] プロファイルスキーマの明示化: `loginMethod`必須、text形式で`output.connectedPattern`・`output.locationPattern`必須、`listLocations.table`・`connectName`必須、`login.stdin`と`source: "secret"`（`optional`）。`enum`・`enumFrom`の削除。ロード時の検証（正規表現の妥当性、`secret`をargvに置かない、`secret`の`pattern`が制御文字を許さない）
- [x] コードから既定値・固有処理を除去: `location-list-parser.ts`（`DEFAULT_TABLE`）、`location-id.ts`（`(Virtual)`除去→`stripPattern`）、`response-parser.ts`（既定の判定・書式）、`profile-loader.ts`（`loginMethod`の既定）、`login-input.ts`（`login.stdin`の解決）、`placeholder-resolver.ts`（`enumFrom`）
- [x] 有効ベンダーの既定値の廃止（`provider-registry.ts`）、旧形式の状態移行（`migrateLegacyState`）の廃止
- [x] プロファイルの読み込みを`VENDORS_DIR/<ID>/profile.json`へ変更（`VPN_PROFILES_DIR`の廃止）
- [x] 既存2プロファイル（動作は不変）の明示化と、単体テストの追随
- [x] バンドルの適合テスト（`vendor-samples.test.ts`・各バンドルの`samples.json`）
- [x] コメント・エラーメッセージ例のベンダー固有名の除去

## 起動時の接続状態の復元（Phase 16、検証完了）

- [x] `PUT /v1/connection`の実行本体を`connection-state/apply-connection.ts`（`applyConnectionChange`）へ切り出し、ルートハンドラから呼ぶ
- [x] `connection-state-store.ts`: 自動接続の成功時にも空の内容（`{}`）で保存するよう拡張、`StoredConnection.country`を省略可に変更
- [x] `connection-state/restore-connection.ts`（`restoreConnectionOnStartup`）: ランナー起動待ち（リトライ）・既接続時のスキップ・保存済み接続先への再接続・失敗時の警告ログ
- [x] `server.ts`から起動時に呼び出す（設定通知と同方針。起動をブロックしない）
- [x] 単体テスト（`restore-connection.test.ts`。保存なし・接続先指定あり/自動接続・既接続・ランナー未起動の各ケース）、既存テスト（`connection-state-store.test.ts`・ルート統合テスト）の回帰確認
- [x] 検証環境（実機）での検証（Proton VPN無料プラン。意図しない切断→APIコンテナ再起動→自動的に再接続されることを確認。`wbs/phase16.md`「検証結果」）。**未検証**: ホスト全体の再起動（ランナー・proxyも同時に起動し直す場合）、AdGuard VPN側での確認

## デプロイメント構成の分離（Phase 25）

- [ ] Web UI利用者の認証: パスワードのハッシュ保存（`api/src/auth/password-store.ts`）、`POST/GET/DELETE /v1/operator-session`（`api/src/routes/operator-session.ts`）、`preHandler`フックによる認可（`require-operator-session.ts`）、レート制限（`login-rate-limiter.ts`）
- [ ] ゲートウェイとの内部通信をUDSからmTLS TCPへ変更（`executeVendorCommand`・`notifySettings`・`fetchProxyStatus`等を`undici`のmTLSクライアントへ置き換え）
- [ ] APIサーバ自身のHTTPS化（Fastifyの`https`オプション）
- [ ] インストーラのペアリング手順（`--gateway-ssh`等）で配置された証明書の読み込み
- [ ] 単体・結合テスト、実機検証（詳細は`../../wbs/phase25.md`）

# 将来課題

- レート制限の閾値のチューニング（Web UIログイン以外の操作系エンドポイントへの適用要否を含む）。
- 監査ログの長期保存・ローテーション方針。
