# Phase 9: プロバイダ抽象化基盤（操作の実行可否によるUI制限）

**【2026-09-21追加】実施順は Phase 4 の直後・Phase 10 の前（`1 → 2 → 3 → 5 → 8 → 4 → 9 → 10 → 6 → 7`）。** Proton VPN対応（Phase 10）の前提として、プロバイダごとの機能差・契約プラン（無料/有料）による制限を、特定プロバイダに依存しない形で扱える基盤を先に作る。フェーズ番号は識別子であり実施順ではない（`README.md`参照）。

## 目的

VPNプロバイダ（AdGuard VPN・Proton VPN等）の機能差・プラン制限を、コードの分岐ではなく管理者向け設定（プロファイル）のデータで表現し、「その操作に対応するコマンドが実行可能か」に基づいてWeb UIの操作を制限（無効化＋理由表示）できるようにする。あわせて、ログイン方式（URL提示型／ユーザー名・パスワード入力型）の差を吸収する。

設計は`specs/design.md`「プロバイダ抽象化アーキテクチャ」、`specs/apiserver/design.md`「Phase 9における具体プロファイル」「オペレーションと実行可否（capability）」「ログイン状態・プランの判定」、`specs/webserver/design.md`「プロバイダ機能差・プラン制限への対応の実装方針」。

## 前提

- Phase 4完了（現行の全機能が検証済み）。
- 実VPN（AdGuard VPN CLI、ログイン済み・PREMIUM）を持つ実機検証環境（`GW_MODE=ssh`）が使えること。**Proton VPN自体はこのフェーズでは使わない**（Phase 10）。代わりにProton VPN CLI（公式1.0.3のソース）と同じ出力・終了コードを返すモックプロバイダCLIで、無料版・有料版・ログイン方式の挙動を再現して検証する。

## スコープ外

- Proton VPN実CLIの導入・Dockerイメージ・実機検証（Phase 10）。
- 接続先単位のプラン制限（無料版では一部の接続先のみ接続可）。AdGuard VPN無料版の`list-locations`が全件を返して接続時に失敗する場合の扱いは、実機（無料アカウント）で確認できていないため未対応（下記「申し送り」）。
- 認証・TLS（Phase 7）。ログインのパスワードはLAN内でHTTP平文になる（既知の制約として受容。`specs/apiserver/design.md`）。

## 決定事項（利用者への確認結果、2026-09-21）

| 項目 | 決定 |
|---|---|
| UIでの制限の見せ方 | 部品は残して無効化し、理由を表示する（消さない） |
| ログイン方式 | Web UIのフォーム入力（ユーザー名・パスワード・2FAコード）。パスワードはCLIの標準入力にのみ渡し、ログ・応答・画面に残さない |
| 判定方式 | 副作用のない読み取り専用コマンドの出力で自動判定（利用者の手動設定にしない）。判定不能なら制限しない |

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件定義・設計・タスク一覧の作成（`specs/`各ファイル、本ファイル、`phase10.md`）。

### proxy
- [ ] `POST /exec`の`stdin`対応（`runCommand`、入力検証、内容をログへ出さない）。
- [ ] `EXTRA_ALLOWED_BINARIES`（E2E専用の追加許可バイナリ）。
- [ ] モックプロバイダCLI（`proxy/mock-cli/protonvpn-mock.mjs`）と`docker-compose.e2e-mock.yml`。
- [ ] `proxy/Dockerfile`を`proxy/Dockerfile.adguardvpn`へ改名し、`docker-compose.yml`を`.env`の`VPN_PROVIDER`（既定`adguardvpn`）で切り替え可能にする（プロファイルを`api/config/profiles/<プロバイダ>.json`へ移動）。

### api
- [ ] プロファイルスキーマ拡張と必須アクションの組合せ検証。
- [ ] オペレーションの実行可否の評価（原因の優先順・依存継承）。
- [ ] `account`判定（30秒キャッシュ・同時要求集約）と`GET /v1/session`。
- [ ] 実行失敗からの学習（`restrictedPattern`→`403 operation_restricted`）。
- [ ] `GET /v1/connection/capabilities`。
- [ ] `POST /v1/session`の`credentials`方式（入力検証・stdin・秘密の伏字化）、`DELETE /v1/session`。
- [ ] `PUT /v1/connection`の`connectAuto`対応（`locationId`省略時）、`501`。
- [ ] 接続先一覧パーサーの汎用化、接続状態出力解釈のプロファイル化。
- [ ] 単体・統合テスト。
- [ ] AdGuard VPNプロファイルへ`account`（`license`）を追加（無料版・未ログイン時の出力を実機で確認したうえで）。

### web
- [ ] orval再生成。
- [ ] `capabilities/capability-state.ts`、`useDashboardPolling`への追加。
- [ ] `SessionCard`・`LoginForm`・`RestrictionNote`、`LocationList`・`ConnectionActions`の制限対応。
- [ ] `403`/`501`のトースト文言と再取得。
- [ ] コンポーネントテスト。

### 検証
- [ ] モックプロバイダCLIでのE2E（`e2e/phase9/`。無料版／有料版／未ログイン、`credentials`ログイン（2FAあり/なし）、403学習、パスワードがログ・応答に残らないこと）。
- [ ] 実VPN（AdGuard VPN）でのリグレッション（`e2e/phase8/`・`e2e/phase5/`が従来どおり通ること。`phase5`の`flow`等は既知の陳腐化のため対象外）。

## 完了基準

- モックの無料版プロバイダで、接続先リスト全体が理由文の枠に置き換わり、［接続］が接続先を指定しない自動接続として使え、接続できること。有料版のモックでは従来どおり接続先リストから選んで接続できること。
- 未ログインのモックで、接続系の操作が「ログインしてください」の理由付きで無効になり、`credentials`のログインフォームからログインすると（2FAあり/なしとも）制限が解除されること。ログアウトで再び制限されること。
- 無料版のモックで接続先指定の接続をAPIへ直接要求すると`403 operation_restricted`が返り、以後capabilityが`planRestricted`になること。ログイン・ログアウトで解除されること。
- プロファイルが対応しない操作（例: `logout`未定義）が`501`で拒否され、UIでも「非対応」の理由付きで無効になること。
- パスワード・2FAコードが、APIのレスポンス・監査ログ・proxyの監査ログ・コンテナのログ・画面のいずれにも現れないこと。
- 実VPN（AdGuard VPN）で、既存の機能（接続先リスト・お気に入り・接続・接続先変更・ログイン）が従来どおり動くこと。

## 検証手法

（実施後に記載する。`e2e/README.md`へ`phase9`の手順を追記する。）

## 次フェーズへの申し送り

- （実装しながら追記する）
- 既知の未確認事項: AdGuard VPN無料版の制限（`list-locations`の返す範囲、接続失敗時の出力）は、検証環境のアカウントがPREMIUMのため実機未確認。全件を返して接続時に失敗する場合は、プランごとの接続先の許可条件（例: `plans[].allowedLocations`）を追加する拡張が必要。
