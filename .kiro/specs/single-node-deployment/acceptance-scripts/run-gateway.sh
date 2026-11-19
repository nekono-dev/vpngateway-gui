#!/bin/bash
# gateway グループだけを run.sh と同じ準備で実行する（runner 利用者、cwd=リポジトリ）
cd /home/runner/repo || exit 2
. e2e/hosted/lib/env.sh; . e2e/hosted/lib/topology.sh; . e2e/hosted/lib/provision.sh; . e2e/hosted/lib/cleanup.sh
hosted_install_traps
A=e2e/artifacts/hosted-gw; mkdir -p "$A"
provision_group_prepare gateway || { echo prepare-failed; sh e2e/hosted/lib/diagnose.sh gateway; exit 2; }
E2E_JSON_OUT="$PWD/$A/gateway.json" npx playwright test -c e2e/hosted/playwright.config.ts --project=gateway --output "$PWD/$A/test-output"
rc=$?; echo "gateway_rc=$rc"
[ "${KEEP_UP:-0}" = 1 ] && { trap - EXIT INT TERM; echo kept-up; }
exit $rc
