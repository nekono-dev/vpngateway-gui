#!/bin/sh
# 責務: セッション開始時に cc-sdd でスキル・設定テンプレートを導入・更新する。プロジェクトの CLAUDE.md だけは上書きから守る。
# 理由: cc-sdd は CLAUDE.md を毎回書き換えるが、利用者が編集した内容を失わないため、実行の前後で退避・復元する。
# 注意: `--overwrite skip` は新規ファイルの作成も止めてしまうため使わない。

set -eu

cd "${CLAUDE_PROJECT_DIR:-.}"

backup=$(mktemp)
had_claude_md=0
if [ -f CLAUDE.md ]; then
  cp CLAUDE.md "$backup"
  had_claude_md=1
fi

npx cc-sdd@latest --yes --claude-skills --lang ja --overwrite force

if [ "$had_claude_md" = 1 ]; then
  cp "$backup" CLAUDE.md
fi
rm -f "$backup"
