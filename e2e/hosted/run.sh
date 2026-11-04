#!/bin/sh
# 責務: hosted E2E の駆動。3 つの群（lifecycle・stack・gateway）を順に実行し、結果を集める（要件 1.2〜1.4・1.6）。
# 終了コード: 全て合格 0、試験の失敗 1、準備（導入・経路）の失敗 2。
# 群ごとに、前回の残りを消してから実行する。準備に失敗した群は全試験を失敗として記録し、残りの群を実行する。
#
# 使い方: npm run test:e2e   （リポジトリルートで）

set -u
cd "$(dirname "$0")/../.."
. e2e/hosted/lib/env.sh
. e2e/hosted/lib/topology.sh
. e2e/hosted/lib/provision.sh

ARTIFACTS="e2e/artifacts/hosted"
mkdir -p "$ARTIFACTS"
RESULT_FILE="$ARTIFACTS/groups.txt"
: > "$RESULT_FILE"

# 1 群を実行する。引数: 群の名前、準備の関数（空なら準備なし）
run_group() {
  group="$1"
  prep="$2"
  # 群の実行プロジェクト（stack は ui → api の順に依存で実行される api を指定する）
  project="$group"
  [ "$group" = stack ] && project="stack-api"
  if [ -n "$prep" ]; then
    if ! prepare_group "$prep"; then
      echo "$group prepare-failed" >> "$RESULT_FILE"
      sh e2e/hosted/lib/diagnose.sh "$group" || true
      return 2
    fi
  fi
  # 出力先は絶対パスで渡す（Playwright は報告の相対パスを設定ファイルの場所基準で解決するため）
  E2E_JSON_OUT="$PWD/$ARTIFACTS/$group.json" npx playwright test -c e2e/hosted/playwright.config.ts --project="$project" --output "$PWD/$ARTIFACTS/$group/test-output"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "$group pass" >> "$RESULT_FILE"
  else
    echo "$group fail" >> "$RESULT_FILE"
    sh e2e/hosted/lib/diagnose.sh "$group" || true
  fi
  return "$rc"
}

# 準備: 前回の導入を消し、経路を作り、導入して起動し、既定経路を切り替える。
# 引数: 準備の種類（stack・gateway）。lifecycle は試験自身が導入するため、この関数を使わない。
# gateway は、ISP の模擬サービス（echo・DoH・平文 DNS）を isp の名前空間で起動してから経路を切り替える。
prepare_group() {
  group="$1"
  topology_down
  if [ -x "$E2E_WORK_DIR/install.sh" ]; then
    sudo sh "$E2E_WORK_DIR/install.sh" uninstall --purge >/dev/null 2>&1 || true
  fi
  topology_links || return 1
  provision_install "$PWD" "$(git rev-parse HEAD)" || return 1
  provision_start || return 1
  if [ "$group" = gateway ]; then provision_isp_start || return 1; fi
  topology_route_isp || return 1
  provision_wait || return 1
  return 0
}

overall=0
# 群の順序: lifecycle（導入を試験自身が行う）→ stack（導入・起動）→ gateway（経路を使う）
run_group lifecycle "" || overall=$?
for group in stack gateway; do
  # stack 群は specs/ui と specs/api からなる（ui が先に実行される）
  case "$group" in
    stack) dirs="e2e/hosted/specs/ui e2e/hosted/specs/api" ;;
    *) dirs="e2e/hosted/specs/$group" ;;
  esac
  # shellcheck disable=SC2086
  if ! ls $dirs/*.spec.ts >/dev/null 2>&1; then
    echo "$group skipped" >> "$RESULT_FILE"
    continue
  fi
  run_group "$group" "$group" || { rc=$?; [ "$rc" -eq 2 ] && [ "$overall" -eq 0 ] && overall=2; [ "$rc" -eq 1 ] && [ "$overall" -eq 0 ] && overall=1; }
done

# 後始末: 経路と導入を戻す（成否にかかわらず）
topology_down
[ -x "$E2E_WORK_DIR/install.sh" ] && sudo sh "$E2E_WORK_DIR/install.sh" uninstall --purge >/dev/null 2>&1 || true

jsons=""
for group in lifecycle stack gateway; do
  [ -s "$ARTIFACTS/$group.json" ] && jsons="$jsons $ARTIFACTS/$group.json"
done
if [ -n "$jsons" ]; then
  # shellcheck disable=SC2086
  npx tsx e2e/hosted/lib/summarize.ts "$ARTIFACTS" $jsons || true
fi
cat "$RESULT_FILE"
exit "$overall"
