# 作業状況と Codex 向け cc-sdd の設定（2026-11-10）

## 現在の作業

- ブランチ: `dev/multihop-backend`。確認時の HEAD: `90af77f`。
- 既存の未コミット変更は、都市選択の仕様・検証記録、多段接続の仕様・discovery、steering、接続処理、API テスト、E2E モックにある。今回の設定作業では保持した。
- 11月8日の引き継ぎは一部古い。現在の `spec.json` では都市選択・多段接続とも要件・設計・タスクが承認済み。今回、承認フラグは変更していない。
- 小タスクのチェック数: `location-city-selection` 29/31、`multihop-backend` 4/25。都市選択の残りは 7.2（階層の操作の検証）と 7.3（全体テスト・中立性検査）。多段接続は 1.1・1.2・3.1・3.2 がチェック済み。
- `location-distance-sort` 20/20、`dark-mode` 16/16、`e2e-tests` 35/35、`vendor-live-e2e` 24/24。これはタスク記録の集計であり、今回の実行による機能全体の検証結果ではない。
- 都市選択の 7.2 には、AdGuard VPN CLI の国名接続を実機で確認する着手ゲートがある。11月9日の検証報告も参照する。多段接続はロードマップ上、都市選択と距離順の対応後に進める。

## 今回の設定変更

- ルートの `AGENTS.md` に Codex 向けの導入・仕様駆動開発・承認・検証手順を追加した。
- `scripts/cc-sdd-session-start.sh` を共有化。引数なし・`--claude` は既存の Claude 向け導入、`--codex` は公式の `--codex-skills` で導入する。
- 呼び出し元のディレクトリによらずリポジトリを対象とする。Claude の既存の SessionStart 設定はそのまま利用できる。
- 更新前に `CLAUDE.md` / `AGENTS.md` を退避し、成功・失敗時とも復元する。Codex では `AGENTS.md` が開始時の実行手順を指示する。

## 検証と制限

- 初回は `.agents/` が読み取り専用だったため、事前検査で停止した。その後、利用者が権限を修正し、`sh scripts/cc-sdd-session-start.sh --codex` が終了コード 0 で成功した。cc-sdd 3.1.0 の17スキル・全68ファイルをプロジェクトへ配置済み。
- 別の一時ディレクトリでは、既にキャッシュされていた cc-sdd 3.1.0 の公式 CLI を使い、`--yes --codex-skills --lang ja --overwrite force` で17スキル・全68ファイルの生成に成功した。ネットワーク経由の `@latest` 取得は検証していない。
- 導入スクリプトの検証では、インストーラを模したコマンドを使い、Claude / Codex の両方で成功・失敗時の指示ファイル復元、別ディレクトリからの実行、不正引数の拒否を確認した。
- `sh -n`・`shellcheck`・`git diff --check` を実施。
- `npm run test -w api -- src/routes/connection-provider.test.ts`: 24件通過。全体テスト・ビルド・実ブラウザ E2E・実 VPN は今回実行していない。
- 権限修正後は実際の `npx cc-sdd@latest` コマンドによる導入が成功した。17個の `SKILL.md` の名前・説明・主要なテンプレート変数の展開を検査し、共通テンプレートに Git 差分がないことも確認した。`sh -n`・`shellcheck`・`git diff --check` は再確認済み。
- 生成される `.codex/agents/spec-reviewer.toml` も、スキルと同じく `.gitignore` の対象に追加した。`.codex/config.toml` や `CLAUDE.md` の差分はない。独立レビューは実施していない。

## 今後の利用

この環境への配置は完了した。新しい環境や次のセッションでは、通常どおり次で導入・更新する。

```sh
sh scripts/cc-sdd-session-start.sh --codex
```

この実行中のセッションのスキル一覧への自動反映は確認していない。必要に応じて Codex セッションを開始し直し、`$kiro-spec-status location-city-selection` で残作業を確認する。導入の検証には、配置された `kiro-verify-completion/SKILL.md` を直接読んで適用した。

参考: [cc-sdd 公式導入手順](https://github.com/gotalab/cc-sdd/blob/main/tools/cc-sdd/README.md)、[OpenAI のスキル作成手順](https://learn.chatgpt.com/docs/build-skills)。
