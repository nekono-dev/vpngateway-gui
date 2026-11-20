#!/bin/sh
# 責務: opt-in の Docker 統合テストで Gateway volume 初期化と権限降格を確認する（通常の npm test には含めず、受け入れタスク 7.5 で実行する。秘密情報は扱わない）。
set -eu

root_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
entrypoint_source=${GATEWAY_ENTRYPOINT_PATH:-$root_dir/compose/gateway-entrypoint.sh}
volume_name="vpngw-gateway-entrypoint-test-$$"
temporary_dir=$(mktemp -d)
container_entrypoint=/gateway-entrypoint.sh

cleanup() {
  docker volume rm -f "$volume_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_dir"
}
trap cleanup EXIT HUP INT TERM

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'SKIP: Docker is unavailable or its daemon cannot be reached.'
  exit 0
fi

if ! docker image inspect alpine:3.21 >/dev/null 2>&1; then
  printf '%s\n' 'SKIP: alpine:3.21 is not present locally; this opt-in test does not pull images.'
  exit 0
fi

if [ ! -f "$entrypoint_source" ]; then
  printf '%s\n' "entrypoint source is missing: $entrypoint_source" >&2
  exit 1
fi

mkdir "$temporary_dir/bin"
cat > "$temporary_dir/bin/node" <<'FIXTURE'
#!/bin/sh
[ "${1:-}" = 'dist/server.js' ] || exit 42
printf 'process=%s:%s volume=' "$(id -u)" "$(id -g)"
stat -c '%u:%g %a' /run/vpngw-gateway
FIXTURE
chmod 0755 "$temporary_dir/bin/node"

docker volume create "$volume_name" >/dev/null

run_entrypoint() {
  docker run --rm \
    --mount "type=volume,src=$volume_name,dst=/run/vpngw-gateway" \
    --mount "type=bind,src=$entrypoint_source,dst=$container_entrypoint,readonly" \
    --mount "type=bind,src=$temporary_dir/bin,dst=/test-bin,readonly" \
    --entrypoint /bin/sh alpine:3.21 -c \
    'apk add --no-cache su-exec >/dev/null && PATH=/test-bin:$PATH; export PATH; exec /bin/sh "$1"' \
    sh "$container_entrypoint"
}

assert_initialized_volume() {
  observed=$1
  if [ "$observed" != 'process=10001:10001 volume=10001:10001 700' ]; then
    printf '%s\n' "unexpected initialized volume or process identity: $observed" >&2
    return 1
  fi
}

first_run=$(run_entrypoint)
assert_initialized_volume "$first_run"

second_run=$(run_entrypoint)
assert_initialized_volume "$second_run"

docker run --rm \
  --mount "type=volume,src=$volume_name,dst=/run/vpngw-gateway" \
  --entrypoint /bin/sh alpine:3.21 -c 'chown -R 2000:2000 /run/vpngw-gateway'
if foreign_run=$(run_entrypoint 2>&1); then
  printf '%s\n' 'entrypoint accepted a foreign-owned volume' "$foreign_run" >&2
  exit 1
fi
case "$foreign_run" in
  *'gateway socket volume must be owned by root or UID/GID 10001'*) ;;
  *) printf '%s\n' 'foreign-owner run failed for an unexpected reason:' "$foreign_run" >&2; exit 1 ;;
esac
case "$foreign_run" in
  *'process='*) printf '%s\n' 'entrypoint launched the process for a foreign-owned volume' >&2; exit 1 ;;
esac

printf '%s\n' 'gateway entrypoint Docker integration tests passed'
