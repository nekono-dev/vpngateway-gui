#!/bin/sh
# 責務: hosted cleanup の順序、固定 project、冪等性、終了コード保持を検証する。

set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/../../.." && pwd)
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
PATH="$TEMP:$PATH"
export PATH
cat > "$TEMP/docker" <<'DOCKER'
#!/bin/sh
printf 'docker %s\n' "$*" >> "$CLEANUP_LOG"
DOCKER
cat > "$TEMP/sudo" <<'SUDO'
#!/bin/sh
printf 'sudo %s\n' "$*" >> "$CLEANUP_LOG"
[ "${SUDO_FAIL:-0}" -eq 0 ] || exit "$SUDO_FAIL"
"$@"
SUDO
cat > "$TEMP/sh" <<'SH'
#!/bin/sh
printf 'sh %s\n' "$*" >> "$CLEANUP_LOG"
SH
chmod +x "$TEMP/docker" "$TEMP/sudo" "$TEMP/sh"
export CLEANUP_LOG="$TEMP/cleanup.log"

# shellcheck disable=SC2016 # 文字列は sh -c のコードであり、変数展開は子 shell に任せる。
env -i PATH="$PATH" CLEANUP_LOG="$CLEANUP_LOG" /bin/sh -c '. "$1"; topology_down() { printf "topology down\\n" >> "$CLEANUP_LOG"; }; hosted_cleanup; hosted_cleanup' sh "$ROOT/e2e/hosted/lib/cleanup.sh"
[ "$(grep -c '^docker ' "$CLEANUP_LOG")" -eq 2 ]
[ "$(grep -c '^sudo sh compose/host-preparation.sh remove$' "$CLEANUP_LOG")" -eq 2 ]
[ "$(grep -c '^topology down$' "$CLEANUP_LOG")" -eq 2 ]
grep -F 'docker compose -p vpngwgui -f docker-compose.yml -f vendors/protonvpn/compose.yml -f vendors/adguardvpn/compose.yml -f docker-compose.e2e-mock.yml down --remove-orphans' "$CLEANUP_LOG" >/dev/null

set +e
# remove の失敗があっても EXIT status 7 を保つ。
# shellcheck disable=SC2016 # 文字列は sh -c のコードであり、変数展開は子 shell に任せる。
env -i PATH="$PATH" CLEANUP_LOG="$CLEANUP_LOG" SUDO_FAIL=1 /bin/sh -c '. "$1"; topology_down() { printf "topology down\\n" >> "$CLEANUP_LOG"; }; hosted_install_traps; exit 7' sh "$ROOT/e2e/hosted/lib/cleanup.sh"
status=$?
set -e
[ "$status" -eq 7 ]
[ "$(grep -c '^docker ' "$CLEANUP_LOG")" -eq 3 ]
[ "$(grep -c '^sudo sh compose/host-preparation.sh remove$' "$CLEANUP_LOG")" -eq 3 ]
[ "$(grep -c '^topology down$' "$CLEANUP_LOG")" -eq 3 ]
