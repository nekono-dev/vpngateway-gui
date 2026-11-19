#!/usr/bin/env bash
# 8.4 補足: proxy 停止中に透過ゲートウェイの有効値を変える PUT（明示プロキシを代わりに有効にして入力検証は満たす）が
# 503 となり永続値が変わらないこと、再開後の再試行で反映されることを確かめ、最後に元へ戻す。cwd=リポジトリ、root。
set -uo pipefail
. e2e/hosted/lib/env.sh
BASE="http://127.0.0.1:${E2E_WEB_PORT}/api"; COOKIE=$(mktemp); CREDS=e2e/hosted/.work/admin.json
PROXY=$(docker compose -p vpngwgui ps -q proxy | head -n1)
stamp() { date -u '+%Y-%m-%dT%H:%M:%S.%3NZ'; }
body=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write(JSON.stringify({username:c.username,password:c.password}))' "$CREDS")
curl -fsS -c "$COOKIE" -H 'content-type: application/json' -d "$body" "$BASE/v1/operator/session" >/dev/null || exit 1
get() { curl -fsS -b "$COOKIE" "$BASE/v1/connection/config" | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(`killSwitch=${c.killSwitch} transparentGatewayEnabled=${c.transparentGatewayEnabled} explicitProxyEnabled=${c.explicitProxyEnabled}`)'; }
put() { curl -sS -w ' HTTP_CODE=%{http_code}' -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "$1" "$BASE/v1/connection/config"; }
trap 'docker unpause "$PROXY" >/dev/null 2>&1; rm -f "$COOKIE"' EXIT
echo "開始時 $(stamp): $(get)"
docker pause "$PROXY" >/dev/null; echo "proxy 一時停止 $(stamp)"
echo "停止中 PUT 透過 false + 明示 true $(stamp): $(put '{"transparentGatewayEnabled":false,"explicitProxyEnabled":true}' | cut -c1-200)"
echo "停止中 PUT 後の永続値 $(stamp): $(get)"
echo "停止中 PUT 有効値を変えない変更（同値）$(stamp): $(put '{"transparentGatewayEnabled":true}' | cut -c1-120)"
docker unpause "$PROXY" >/dev/null; echo "proxy 再開 $(stamp)"; sleep 3
echo "再開後 再試行 $(stamp): $(put '{"transparentGatewayEnabled":false,"explicitProxyEnabled":true}' | grep -o 'HTTP_CODE=[0-9]*')"
echo "再開後の永続値 $(stamp): $(get)"
echo "元へ戻す $(stamp): $(put '{"transparentGatewayEnabled":true,"explicitProxyEnabled":false}' | grep -o 'HTTP_CODE=[0-9]*')"
echo "終了時 $(stamp): $(get)"
