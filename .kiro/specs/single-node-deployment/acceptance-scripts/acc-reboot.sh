#!/usr/bin/env bash
# 8.5 再起動要求: 管理画面と同じ API（POST /api/v1/gateway/reboot、管理者パスワード再入力）で再起動を依頼する。root、cwd=/root/vpngwgui。
set -uo pipefail
BASE=http://127.0.0.1:18080/api; COOKIE=$(mktemp); CREDS=e2e/hosted/.work/admin.json
login=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write(JSON.stringify({username:c.username,password:c.password}))' "$CREDS")
pw=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write(JSON.stringify({password:c.password}))' "$CREDS")
curl -fsS -c "$COOKIE" -H 'content-type: application/json' -d "$login" "$BASE/v1/operator/session" >/dev/null || exit 1
echo "boot_id 前: $(cat /proc/sys/kernel/random/boot_id)"
echo "依頼 $(date -u +%FT%T.%3NZ): $(curl -sS -w ' HTTP_CODE=%{http_code}' -b "$COOKIE" -H 'content-type: application/json' -d "$pw" "$BASE/v1/gateway/reboot")"
rm -f "$COOKIE"
