#!/bin/sh
# 責務: Claude の cc-sdd スキルを更新し、Codex では未導入時だけ導入する。
# 理由: 生成される指示ファイルを、失敗時も含めて退避・復元する。
# 注意: `--overwrite skip` は新規ファイルの作成も止めてしまうため使わない。

set -eu

case "${1:---claude}" in
  --claude) agent=--claude-skills; document=CLAUDE.md; skills_root=.claude; codex_mode=0 ;;
  --codex) agent=--codex-skills; document=AGENTS.md; skills_root=.agents; codex_mode=1 ;;
  *) echo "Usage: sh scripts/cc-sdd-session-start.sh [--claude|--codex]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "引数が多すぎます" >&2; exit 2; }

project_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

# Codex は全スキルが揃っていれば導入コマンドを実行しない。
if [ "$codex_mode" = 1 ]; then
  skills_complete=1
  for skill in \
    kiro-debug \
    kiro-discovery \
    kiro-impl \
    kiro-review \
    kiro-spec-batch \
    kiro-spec-design \
    kiro-spec-init \
    kiro-spec-quick \
    kiro-spec-requirements \
    kiro-spec-status \
    kiro-spec-tasks \
    kiro-steering \
    kiro-steering-custom \
    kiro-validate-design \
    kiro-validate-gap \
    kiro-validate-impl \
    kiro-verify-completion
  do
    if [ ! -f "$skills_root/skills/$skill/SKILL.md" ]; then
      skills_complete=0
      break
    fi
  done
  if [ "$skills_complete" = 1 ]; then
    echo "cc-sdd: Codex 向けスキル17件が揃っているため、導入をスキップします。"
    exit 0
  fi
fi

# Claude の既存動作では、書き込み禁止の配置先で部分更新を始めない。
if [ "$codex_mode" = 0 ] && [ -d "$skills_root" ] && [ ! -w "$skills_root" ]; then
  echo "cc-sdd: $project_dir/$skills_root が書き込み禁止です。書き込み可能な環境で再実行してください。" >&2
  exit 1
fi

backup=$(mktemp)
had_document=0
if [ -f "$document" ]; then
  cp "$document" "$backup"
  had_document=1
fi

restore_document() {
  if [ "$had_document" = 1 ]; then
    cp "$backup" "$document"
  fi
  rm -f "$backup"
}
trap restore_document EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

npx cc-sdd@latest --yes "$agent" --lang ja --overwrite force
