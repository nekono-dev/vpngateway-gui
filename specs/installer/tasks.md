# インストーラ タスク一覧

## Phase 1: 本体インストーラ

- 対応: D-1, D-2, D-3, D-7, D-8
- [x] T-1.1: 引数の解釈と、設定値から引数への変換・検証を実装する。
- [x] T-1.2: 事前検査・依存導入・Docker導入・ホスト設定・`.env` 更新・起動の各工程を実装する。
- [x] T-1.3: ベンダーのホスト側手順の呼び出しと、composeの合成を実装する。
- [x] T-1.4: 受け入れ条件のタグ付きで、本体インストーラの受け入れテストを追加する。
- 検証: `sh installer/tests/run.sh && npx vitest run --config tests/vitest.config.ts tests/installer/setup.test.ts`

## Phase 2: 分離配置と証明書

- 対応: D-4, D-5, D-6
- [x] T-2.1: ロールの配置先の指定、トポロジーの記録と再実行時の照合を実装する。
- [x] T-2.2: リモートホストへの到達性検査、ソース転送、リモート導入を実装する。
- [x] T-2.3: 証明書の生成と、ローカル・リモートへの配布を実装する。
- [x] T-2.4: 配置と証明書の受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/installer/topology.test.ts tests/installer/pki.test.ts`

## Phase 3: アンインストールと頒布

- 対応: D-9, D-10, D-11
- [x] T-3.1: 記録済みのトポロジーに基づくアンインストールを実装する。
- [x] T-3.2: 頒布用スクリプトの生成と、タグ・ブランチごとの公開をCIへ組み込む。
- [x] T-3.3: 頒布用スクリプトの受け入れテストと、`installer/tests/run.sh` の検査を整える。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/installer/distribution.test.ts`
