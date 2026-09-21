# Phase 12: ベンダー非依存化（ベンダーバンドル・プロファイルの明示化）

**【2026-09-21追加】実施順は Phase 10（実装まで）の後・Phase 13の前**（`… → 11 → 10 → 12 → 13 → 6 → 7`）。フェーズ番号は識別子であり実施順ではない（`README.md`参照）。

## 目的

「VPNプロバイダに依存しない形でWeb UI・プロキシを提供する」という本システムの目的に沿い、ソースコードに残っているベンダー固有の値・分岐をすべて抽象化し、プロファイルとベンダーバンドル（`vendors/<ID>/`）へ移す。ベンダーの追加・削除を、バンドルの追加・削除だけで完結させる。

要件は`specs/requirements.md`「ベンダー非依存性」、設計は`specs/design.md`「ベンダー非依存の設計原則」、`specs/apiserver/design.md`「Phase 12におけるプロファイルの明示化」、`specs/runner/design.md`「ベンダーの追加方法」。

## 前提

- Phase 11完了（ランナー分離）、Phase 10の実装（`runner-protonvpn`）。
- **動作は変えない。** 既存の2ベンダーのプロファイルは、従来の暗黙の既定値と同じ値を明示するだけ。単体テスト・E2E（phase8のリグレッション）が同じ結果になることで確認する。

## スコープ外

- 既存の単体テスト内のベンダー名・実出力の直書きの中立化（テストは中立性の検査の対象外。新規は中立なfixtureを推奨）。
- 接続先モデルのISO国コード前提（`table.iso`必須・IDの形式）の一般化（国名のみを出すCLI向け。`specs/apiserver/tasks.md`の将来課題）。
- インストーラ（Phase 13）。ただしこのフェーズで、`install/select-providers.sh`を`COMPOSE_FILE`方式へ暫定的に追随させる（Phase 13で`install/install.sh`へ統合して削除）。

## 決定事項（利用者への確認結果、2026-09-21）

| 項目 | 決定 |
|---|---|
| 配布物の構成 | `vendors/<ID>/`の1ディレクトリにまとめる（プロファイル・ランナーの資材・composeのfragment） |
| 中立性の検査 | コメントも検査する |
| 既存の単体テスト | 今回は中立化しない |

## 設計上の判断（本文書の作成時、確認なしに決めた点。誤りがあれば指摘を受けて改訂する）

- 旧形式の状態ファイルの移行は**廃止**する（移行用スクリプトも作らない）。未リリースで、実機はPhase 11で移行済みのため。
- `connectNameFrom`は`connectName: { from, stripPattern? }`へ置き換える（`(Virtual)`の除去をコードから外すため）。
- ログインの標準入力は`login.stdin`（行のテンプレート）と`source: "secret"`で表す。ログインのフォームの項目（ユーザー名・パスワード・2FA）は、APIの固定の語彙のまま。
- `docker-compose.yml`の合成は`.env`の`COMPOSE_FILE`（`profiles`は廃止）。
- E2E用のモックベンダーも同じ形のバンドル（`e2e/vendors/mockproton/`）にする。

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件・設計・タスク・AGENTS.mdへの反映（本ファイルを含む）。

### api（`specs/apiserver/tasks.md`「ベンダー非依存化」）
- [ ] プロファイルスキーマの明示化・検証、コードからの既定値・固有処理の除去、`enum`の削除。
- [ ] 有効ベンダーの既定値の廃止、旧形式の状態移行の廃止、`VENDORS_DIR`への変更。
- [ ] 既存2プロファイルの明示化、単体テストの追随。

### ベンダーバンドル化（`specs/runner/tasks.md`「ベンダーバンドル化」）
- [ ] `vendors/adguardvpn/`・`vendors/protonvpn/`（`profile.json`・`Dockerfile`・`entrypoint.sh`・付属の設定・`compose.yml`）へ移動し、`docker-compose.yml`の本体からランナー・ベンダー別ボリュームを除去。
- [ ] E2E用モックベンダーのバンドル化（`e2e/vendors/mockproton/`）と、E2Eスクリプト・`docker-compose.e2e-mock.yml`の追随。
- [ ] `install/select-providers.sh`の暫定の追随（`VPN_PROVIDERS`・`COMPOSE_FILE`を書く）。

### 再発防止
- [ ] 中立性の検査（`scripts/check-vendor-neutrality.mjs`）とルートの`npm test`への組み込み。
- [ ] バンドルの適合テスト（`vendor-samples.test.ts`・`samples.json`）。
- [ ] 本番コードのコメント・エラーメッセージ例のベンダー固有名の除去。

## 完了基準

- 中立性の検査が、本番コードで0件（違反を1件混ぜると失敗することも確認）。
- `npm test`（proxy・api・web・検査）が通る。
- `docker compose config`が、`COMPOSE_FILE`の合成（1ベンダー・2ベンダー）で成功し、無効なベンダーのランナーが含まれない。`VPN_PROVIDERS`未設定なら失敗する。
- 実VPN（AdGuard）とモックベンダーで、既存のE2E（`e2e/phase8`・`phase9`・`phase11`）が従来と同じ結果で通る。
- ベンダー追加の実証: モックの別名バンドルを1つ追加するだけ（共通部を変更せず）で、Web UIの選択肢に現れ、選択できること。

## 検証手法

- 単体・統合テスト: `npm test`。
- 中立性の検査: `node scripts/check-vendor-neutrality.mjs`。
- E2E: `e2e/phase9/mock-scenarios.sh`・`e2e/phase11/provider-scenarios.sh`（モック）、実VPNは`GW_MODE=ssh`で`e2e/phase8/locations-scenarios.sh`。

## 次フェーズへの申し送り

- （実施後に記載）
