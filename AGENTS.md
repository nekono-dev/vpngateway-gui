# Codex 向け作業規約

## cc-sdd の導入と更新

このプロジェクトでは cc-sdd の Codex Skills を使う。セッション開始時に次を実行する。

```sh
sh scripts/cc-sdd-session-start.sh --codex
```

スクリプトは17個すべての `SKILL.md` が存在する場合は何も変更せず終了し、1つでも不足する場合だけ `--codex-skills --lang ja --overwrite force` で導入する。不足時は導入コマンドを実行し、必要な書き込み権限の承認は Codex に委ねる。`AGENTS.md` は実行に失敗した場合も退避・復元する。`--overwrite skip` は使わない。Codex で Claude のフックが動くとは仮定しない。

生成先は `.agents/skills/kiro-*/`、共通テンプレートは `.kiro/settings/`。生成スキルは Git 管理せず、不足している環境でだけ導入する。書き込み権限やネットワークの制限で導入できない場合は、制限を報告し、導入済みとは扱わない。制限の回避や設定の緩和は行わない。スキルの自動検出に反映されない場合はセッションを開始し直す。

## 現在の作業の把握

- 最初に `git status --short --branch` と差分を確認し、既存の未コミット変更を保持する。
- `.kiro/handoff/` の最新の記録を確認する。古い引き継ぎよりも、現在のコード・`spec.json`・`tasks.md` と新しい検証報告を優先する。
- 要件・設計・実装に関する作業では `.kiro/steering/product.md`・`tech.md`・`structure.md` を読み、必要に応じて `roadmap.md`・`ui-conventions.md` を参照する。
- 会話は日本語。仕様書などの Markdown は対象の `spec.json.language` に従う。

## 仕様駆動の進め方

- 仕様は `.kiro/specs/<feature>/`、プロジェクトの方針は `.kiro/steering/` を共有する。Claude 用の別仕様を作らない。
- 進捗確認: `$kiro-spec-status <feature>`。
- 新しい作業の整理: `$kiro-discovery <idea>`。
- 仕様: `$kiro-spec-init` → `$kiro-spec-requirements` → `$kiro-spec-design` → `$kiro-spec-tasks`。
- 実装: `$kiro-impl <feature> [tasks]`、検証: `$kiro-validate-impl <feature>`。
- 要件 → 設計 → タスク → 実装の承認フローを守る。利用者の明示的な指示がない限り、`spec.json` の承認フラグを変更しない。`-y` や `--auto` は、利用者が意図して指定した場合に限る。
- スキルは説明から選び、必要な `SKILL.md` と参照ファイルだけを読む。ホスト側の制約・指示を優先する。
- `CLAUDE.md` の「Claude が Codex MCP に委譲する」規則は Claude 向け。Codex 自身が再帰的に `codex_exec` を呼ぶ規則として解釈しない。
- 独立レビューを実施していない場合は、その旨を明記する。チェックボックスや過去の成功記録だけで完了を宣言せず、現在の状態に対する検証結果を示す。

## 実装と検証

- ベンダー固有の挙動は `vendors/<ID>/profile.json` に宣言し、本体にベンダーの条件分岐を追加しない。
- `api/openapi.json`・`web/src/generated/` は手で編集せず、`npm run generate:api-client` で生成する。
- コメントは日本語、識別子は英語。変更した範囲に合った検証を行う。
- 主な検証: `npm test`、`npm run build`、`npm run test:e2e-unit`。実ブラウザ E2E は `npm run test:e2e`、実 VPN の試験は `npm run test:vendor-live`。
- 実行できなかった試験は、理由と残る確認事項を報告する。導入作業だけでアプリケーション全体の検証済みとは扱わない。
