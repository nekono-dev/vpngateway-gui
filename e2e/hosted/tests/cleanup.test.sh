#!/bin/sh
# 責務: hosted cleanup の固定 Compose project・冪等性・終了コード保持を検証する。

set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/../../.." && pwd)
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
PATH="$TEMP:$PATH"
export PATH
cat > "$TEMP/docker" <<'DOCKER'
#!/bin/sh
printf '%s\n' "$*" >> "$CLEANUP_LOG"
DOCKER
chmod +x "$TEMP/docker"
export CLEANUP_LOG="$TEMP/docker.log"

# shellcheck disable=SC2016 # 文字列は sh -c のコードであり、変数展開は子 shell に任せる。
if env -i PATH="$PATH" CLEANUP_LOG="$CLEANUP_LOG" sh -c '. "$1"; topology_down() { :; }; hosted_cleanup; hosted_cleanup' sh "$ROOT/e2e/hosted/lib/cleanup.sh"; then :; else
  exit 1
fi
[ "$(wc -l < "$CLEANUP_LOG")" -eq 2 ]
grep -F 'compose -p vpngwgui -f docker-compose.yml -f vendors/protonvpn/compose.yml -f vendors/adguardvpn/compose.yml -f docker-compose.e2e-mock.yml down --remove-orphans' "$CLEANUP_LOG" >/dev/null

set +e
# shellcheck disable=SC2016 # 文字列は sh -c のコードであり、変数展開は子 shell に任せる。
env -i PATH="$PATH" CLEANUP_LOG="$CLEANUP_LOG" sh -c '. "$1"; topology_down() { :; }; hosted_install_traps; exit 7' sh "$ROOT/e2e/hosted/lib/cleanup.sh"
status=$?
set -e
[ "$status" -eq 7 ]
[ "$(wc -l < "$CLEANUP_LOG")" -eq 3 ]
