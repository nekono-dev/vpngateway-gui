# Phase 10: ベンダー非依存化（ベンダーバンドル・プロファイルの明示化）

（2026-09-21追加: Phase 9（Proton VPN対応）の実装が一区切りついた後、Phase 11（インストーラと頒布）の前に実施する。）

## 目的

「VPNプロバイダに依存しない形でWeb UI・プロキシを提供する」という本システムの目的に沿い、ソースコードに残っているベンダー固有の値・分岐をすべて抽象化し、プロファイルとベンダーバンドル（`vendors/<ID>/`）へ移す。ベンダーの追加・削除を、バンドルの追加・削除だけで完結させる。

要件は`specs/requirements.md`「ベンダー非依存性」、設計は`specs/design.md`「ベンダー非依存の設計原則」、`specs/apiserver/design.md`「Phase 10におけるプロファイルの明示化」、`specs/runner/design.md`「ベンダーの追加方法」。

## 前提

- Phase 8完了（ランナー分離）、Phase 9の実装（`runner-protonvpn`）。
- **動作は変えない。** 既存の2ベンダーのプロファイルは、従来の暗黙の既定値と同じ値を明示するだけ。単体テスト・E2E（phase5のリグレッション）が同じ結果になることで確認する。

## スコープ外

- 既存の単体テスト内のベンダー名・実出力の直書きの中立化（テストは中立性の検査の対象外。新規は中立なfixtureを推奨）。
- 接続先モデルのISO国コード前提（`table.iso`必須・IDの形式）の一般化（国名のみを出すCLI向け。`specs/apiserver/tasks.md`の将来課題）。
- インストーラ（Phase 11）。ただしこのフェーズで、`install/select-providers.sh`を`COMPOSE_FILE`方式へ暫定的に追随させる（Phase 11で`install/install.sh`へ統合して削除）。

## 決定事項（利用者への確認結果、2026-09-21）

| 項目 | 決定 |
|---|---|
| 配布物の構成 | `vendors/<ID>/`の1ディレクトリにまとめる（プロファイル・ランナーの資材・composeのfragment） |
| 中立性の検査 | コメントも検査する |
| 既存の単体テスト | 今回は中立化しない |

## 設計上の判断（本文書の作成時、確認なしに決めた点。誤りがあれば指摘を受けて改訂する）

- 旧形式の状態ファイルの移行は**廃止**する（移行用スクリプトも作らない）。未リリースで、実機はPhase 8で移行済みのため。
- `connectNameFrom`は`connectName: { from, stripPattern? }`へ置き換える（`(Virtual)`の除去をコードから外すため）。
- ログインの標準入力は`login.stdin`（行のテンプレート）と`source: "secret"`で表す。ログインのフォームの項目（ユーザー名・パスワード・2FA）は、APIの固定の語彙のまま。
- `docker-compose.yml`の合成は`.env`の`COMPOSE_FILE`（`profiles`は廃止）。
- E2E用のモックベンダーも同じ形のバンドル（`e2e/vendors/mockproton/`）にする。

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件・設計・タスク・AGENTS.mdへの反映（本ファイルを含む）。

### api（`specs/apiserver/tasks.md`「ベンダー非依存化」）
- [x] プロファイルスキーマの明示化・検証、コードからの既定値・固有処理の除去、`enum`の削除。
- [x] 有効ベンダーの既定値の廃止、旧形式の状態移行の廃止、`VENDORS_DIR`への変更。
- [x] 既存2プロファイルの明示化、単体テストの追随。

### ベンダーバンドル化（`specs/runner/tasks.md`「ベンダーバンドル化」）
- [x] `vendors/adguardvpn/`・`vendors/protonvpn/`（`profile.json`・`Dockerfile`・`entrypoint.sh`・付属の設定・`compose.yml`）へ移動し、`docker-compose.yml`の本体からランナー・ベンダー別ボリュームを除去。
- [x] E2E用モックベンダーのバンドル化（`e2e/vendors/mockproton/`）と、E2Eスクリプト・`docker-compose.e2e-mock.yml`の追随。
- [x] `install/select-providers.sh`の暫定の追随（`VPN_PROVIDERS`・`COMPOSE_FILE`を書く）。

### 再発防止
- [x] 中立性の検査（`scripts/check-vendor-neutrality.mjs`）とルートの`npm test`への組み込み。
- [x] バンドルの適合テスト（`vendor-samples.test.ts`・`samples.json`）。
- [x] 本番コードのコメント・エラーメッセージ例のベンダー固有名の除去。

## 完了基準

- 中立性の検査が、本番コードで0件（違反を1件混ぜると失敗することも確認）。
- `npm test`（proxy・api・web・検査）が通る。
- `docker compose config`が、`COMPOSE_FILE`の合成（1ベンダー・2ベンダー）で成功し、無効なベンダーのランナーが含まれない。`VPN_PROVIDERS`未設定なら失敗する。
- 実VPN（AdGuard）とモックベンダーで、既存のE2E（`e2e/phase5`・`phase7`・`phase8`）が従来と同じ結果で通る。
- ベンダー追加の実証: モックの別名バンドルを1つ追加するだけ（共通部を変更せず）で、Web UIの選択肢に現れ、選択できること。

## 検証手法

- 単体・統合テスト: `npm test`。
- 中立性の検査: `node scripts/check-vendor-neutrality.mjs`。
- E2E: `e2e/phase7/mock-scenarios.sh`・`e2e/phase8/provider-scenarios.sh`（モック）、実VPNは`GW_MODE=ssh`で`e2e/phase5/locations-scenarios.sh`。

## 検証結果（2026-09-21）

- 単体・統合テスト: `npm test`（proxy 101件・api 237件・web 92件・中立性の検査OK）。中立性の検査は、違反を混入させると失敗する（2件検出・終了コード1）ことも確認した。
- バンドルの適合テスト（`vendor-samples.test.ts`）15件: 全バンドルのプロファイル検証と、各`samples.json`（実CLIの出力サンプル）の共通処理での判定。
- モックE2E（開発ホストのdocker compose）: `e2e/phase7/mock-scenarios.sh` 36項目、`e2e/phase8/provider-scenarios.sh` 27項目、`e2e/phase10/add-vendor-scenarios.sh` 7項目（別名のバンドルを1ディレクトリ複製するだけで、共通部を変更せずに新ベンダーが一覧に現れ・選択でき、外すと消える）。すべてFAIL 0。
- 実VPN（AdGuard VPN・実機ゲートウェイ`GW_MODE=ssh`）: `e2e/phase5/locations-scenarios.sh` 46項目 FAIL 0（既存のログイン情報のボリュームを引き継いだまま、バンドル方式のcomposeで起動し直して確認）。`e2e/phase8/real-switch-scenarios.sh` 10項目 FAIL 0（実VPN接続中にモックへ切替→実VPN切断・Kill Switchで遮断→切り戻して再接続）。

## 次フェーズへの申し送り

- **既存環境のボリュームは引き継がれる**（ボリューム名を変えていない）。ただし、既存環境の`.env`は`COMPOSE_PROFILES`から`COMPOSE_FILE`へ更新する必要がある（`install/select-providers.sh`が書き換える。Phase 11の`install.sh`が担う）。更新せずに`docker compose up`すると、`VPN_PROVIDERS`が有れば起動はするがランナーが起動しない。
- 旧形式の状態ファイルの移行（`migrateLegacyState`）と`proxy/mock-cli/adguardvpn-cli-mock.mjs`（Phase 1のモック。どこからも使われていなかった）を削除した。
- 別のセッションが並行して進めていたPhase 12（プランで接続できる接続先の参考表示）は、`api/config/profiles/protonvpn.json`・`api/src/profile/profile.schema.ts`・`docker-compose.yml`の`api`（`proton-cache`のマウントと`PROVIDER_CACHE_DIR`）を変更している。本フェーズで`api/config/profiles/`は`vendors/<ID>/profile.json`へ移り、composeの`api`のマウントは、Proton VPNのバンドルの`compose.yml`（`services.api.volumes`へ`proton-cache:/var/lib/vpngwgui-provider-cache/protonvpn:ro`を足す。composeの合成でマージされる）へ移すのが本来の形（`specs/apiserver/design.md`のPhase 12の記述の注記）。マージ時の作業として引き継ぐ。
- プロファイルの`login.stdin`の行の順序・2FAコードの形式は、Proton VPNの実CLI（`signin`）の入力仕様のまま（ロジックは変えず、プロファイルへ移した）。2FAが必要な実アカウントでの確認は、Phase 9の残りの検証に含まれる。
- E2Eの`e2e/phase3`・`phase4`・`phase6`は、検証環境の`.env`が`COMPOSE_FILE`方式へ更新済みであることを前提にする（`GW_MODE=ssh`。`sync.sh`は`.env`を上書きしない）。
- `nftables`パッケージ由来の`nftables.service`・Debian系での起動時ルールの消失は、Phase 11で扱う（未検証）。
