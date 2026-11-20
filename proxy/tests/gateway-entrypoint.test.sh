#!/bin/sh
# 責務: Gateway entrypoint の安全な volume 初期化と権限降格を検証する。
set -eu

root_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM
mkdir "$temporary_dir/bin" "$temporary_dir/volume"
export ENTRYPOINT_TEST_LOG="$temporary_dir/calls"
export ENTRYPOINT_TEST_ROOT=0
export ENTRYPOINT_TEST_OWNER=0:0
export ENTRYPOINT_TEST_MODE=0755
export PATH="$temporary_dir/bin:$PATH"
sed "s|/run/vpngw-gateway|$temporary_dir/volume|g" "$root_dir/compose/gateway-entrypoint.sh" > "$temporary_dir/entrypoint.sh"

cat > "$temporary_dir/bin/id" <<'FIXTURE'
#!/bin/sh
if [ "${1:-}" = "-u" ]; then printf '%s\n' "$ENTRYPOINT_TEST_ROOT"; else exit 1; fi
FIXTURE
cat > "$temporary_dir/bin/stat" <<'FIXTURE'
#!/bin/sh
[ "${1:-}" = "-c" ] || exit 2
printf '%s %s\n' "$ENTRYPOINT_TEST_OWNER" "$ENTRYPOINT_TEST_MODE"
FIXTURE
for command_name in chown chmod su-exec; do
  cat > "$temporary_dir/bin/$command_name" <<'FIXTURE'
#!/bin/sh
printf '%s' "${0##*/}" >> "$ENTRYPOINT_TEST_LOG"
for argument do printf ' <%s>' "$argument" >> "$ENTRYPOINT_TEST_LOG"; done
printf '\n' >> "$ENTRYPOINT_TEST_LOG"
if [ "${FAIL_ENTRYPOINT_COMMAND:-}" = "${0##*/}" ]; then exit 1; fi
if [ "${0##*/}" = su-exec ]; then exit 0; fi
FIXTURE
  chmod +x "$temporary_dir/bin/$command_name"
done
chmod +x "$temporary_dir/bin/id" "$temporary_dir/bin/stat"

assert_rejected_without_mutation() {
  description=$1
  : > "$ENTRYPOINT_TEST_LOG"
  if sh "$temporary_dir/entrypoint.sh" 2>/dev/null; then
    printf '%s\n' "entrypoint accepted $description" >&2
    exit 1
  fi
  if [ -s "$ENTRYPOINT_TEST_LOG" ]; then
    printf '%s\n' "entrypoint ran chown/chmod/su-exec for $description" >&2
    cat "$ENTRYPOINT_TEST_LOG" >&2
    exit 1
  fi
}

sh "$temporary_dir/entrypoint.sh"
first_calls=$(sed -n '1,3p' "$ENTRYPOINT_TEST_LOG")
expected_calls=$(cat <<EOF_CALLS
chown <-h> <10001:10001> <$temporary_dir/volume>
chmod <0700> <$temporary_dir/volume>
su-exec <10001:10001> <node> <dist/server.js>
EOF_CALLS
)
if [ "$first_calls" != "$expected_calls" ]; then
  printf '%s\n' "unexpected entrypoint command sequence:" "$first_calls" >&2
  exit 1
fi
: > "$ENTRYPOINT_TEST_LOG"
ENTRYPOINT_TEST_OWNER=10001:10001
export ENTRYPOINT_TEST_OWNER
sh "$temporary_dir/entrypoint.sh"
ENTRYPOINT_TEST_OWNER=0:0
export ENTRYPOINT_TEST_OWNER

if grep -q '^USER vpngwgui$' "$root_dir/proxy/Dockerfile"; then
  printf '%s\n' 'proxy image must start with the root entrypoint' >&2
  exit 1
fi
proxy_compose=$(sed -n '/^  proxy:/,/^networks:/p' "$root_dir/docker-compose.yml")
case "$proxy_compose" in
  *'user:'*) printf '%s\n' 'Compose must not pin proxy to a non-root user' >&2; exit 1 ;;
esac

after_failure_no_su_exec() {
  command_name=$1
  : > "$ENTRYPOINT_TEST_LOG"
  if FAIL_ENTRYPOINT_COMMAND=$command_name sh "$temporary_dir/entrypoint.sh" 2>/dev/null; then
    printf '%s\n' "entrypoint continued after $command_name failure" >&2
    exit 1
  fi
  if grep -q '^su-exec ' "$ENTRYPOINT_TEST_LOG"; then
    printf '%s\n' "entrypoint reached su-exec after $command_name failure" >&2
    exit 1
  fi
}
after_failure_no_su_exec chown
after_failure_no_su_exec chmod
: > "$ENTRYPOINT_TEST_LOG"
if FAIL_ENTRYPOINT_COMMAND=su-exec sh "$temporary_dir/entrypoint.sh" 2>/dev/null; then
  printf '%s\n' 'entrypoint continued after su-exec failure' >&2
  exit 1
fi
if ! grep -q '^su-exec ' "$ENTRYPOINT_TEST_LOG"; then
  printf '%s\n' 'entrypoint did not attempt su-exec' >&2
  exit 1
fi

ENTRYPOINT_TEST_ROOT=1000
export ENTRYPOINT_TEST_ROOT
assert_rejected_without_mutation 'a non-root start'
ENTRYPOINT_TEST_ROOT=0
export ENTRYPOINT_TEST_ROOT

rm -rf "$temporary_dir/volume"
ln -s "$temporary_dir/target" "$temporary_dir/volume"
mkdir "$temporary_dir/target"
assert_rejected_without_mutation 'a symlink volume'
rm "$temporary_dir/volume"
: > "$temporary_dir/volume"
assert_rejected_without_mutation 'a non-directory volume'
rm "$temporary_dir/volume"
mkdir "$temporary_dir/volume"
ENTRYPOINT_TEST_OWNER=2345:2345
export ENTRYPOINT_TEST_OWNER
assert_rejected_without_mutation 'a foreign-owned volume'
ENTRYPOINT_TEST_OWNER=0:0
export ENTRYPOINT_TEST_OWNER

printf '%s\n' 'gateway entrypoint tests passed'
