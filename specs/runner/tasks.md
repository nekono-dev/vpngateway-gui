# ランナー タスク一覧

## Phase 1: 受け口と実行

- 対応: D-1, D-2, D-3, D-4, D-5
- [x] T-1.1: Unixドメインソケット上の稼働確認と実行要求の受け口を実装する。
- [x] T-1.2: 許可バイナリの照合と、要求形状の検証・応答を実装する。
- [x] T-1.3: シェルを介さない実行、完了判定、標準入力の受け渡しを実装する。
- [x] T-1.4: 受け入れ条件のタグ付きで、実行まわりの受け入れテストを追加する。
- 検証: `npm run test -w proxy && npx vitest run --config tests/vitest.config.ts tests/runner/exec.test.ts tests/runner/runner-process.test.ts`

## Phase 2: ベンダーバンドル

- 対応: D-6, D-7, D-8, D-9
- [x] T-2.1: 単体バイナリ型CLIのバンドル（イメージ・定義・起動処理）を作成する。
- [x] T-2.2: 常駐サービス依存型CLIのバンドルと、その実行環境の起動処理を作成する。
- [x] T-2.3: バンドルの構成・権限・永続化を検査する受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/runner/bundle.test.ts`

## Phase 3: 中立性の検査

- 対応: D-10
- [x] T-3.1: 本番コードのベンダー固有語を検出する検査スクリプトを実装する。
- [x] T-3.2: 検査を受け入れテストと `npm test` に組み込む。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/runner/neutrality.test.ts`
