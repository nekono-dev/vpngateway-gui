#!/bin/sh
# 責務: apply の段階順と失敗時の停止位置を検証する
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree="$temporary/tree"
mkdir -p "$tree/compose/host-preparation"
cp "$root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cli="$tree/compose/host-preparation.sh"
record="$temporary/calls"
export record
cat > "$tree/compose/host-preparation/paths.sh" <<'PATHS'
hp_os_release_path=/dev/null
hp_repo_root=/tmp
hp_state_dir="$record.state"
hp_docker_daemon_config_path="$record.daemon.json"
hp_sysctl_config_path="$record.sysctl"
hp_boot_guard_unit_path="$record.guard"
hp_boot_guard_docker_requires_path="$record.requires"
hp_boot_guard_rules_path="$record.rules"
PATHS
cat > "$tree/compose/host-preparation/common.sh" <<'COMMON'
hp_error() { printf 'ERROR:%s\n' "$*" >&2; exit 1; }
hp_check_prerequisites() { printf 'static\n' >> "$record"; [ "${FAIL-}" != static ]; }
COMMON
cat > "$tree/compose/host-preparation/docker-install.sh" <<'DOCKER'
hp_docker_prepare() { printf 'docker-prepare\n' >> "$record"; [ "${FAIL-}" != docker ] && [ "${CONSENT-yes}" = yes ] && [ "${TTY-yes}" = yes ]; }
hp_docker_assess() { printf 'docker-assess\n' >> "$record"; printf '%s\n' "${ASSESS-ready}"; }
hp_docker_engine_version() { printf '%s\n' 28.0.0; }
DOCKER
cat > "$tree/compose/host-preparation/host-reboot.sh" <<'HOST'
hp_check_host_reboot_accounts() { printf 'accounts\n' >> "$record"; [ "${FAIL-}" != accounts ]; }
hp_apply_host_reboot() { printf 'host-reboot\n' >> "$record"; [ "${FAIL-}" != host ]; }
HOST
cat > "$tree/compose/host-preparation/state.sh" <<'STATE'
hp_state_initialize() { printf 'state\n' >> "$record"; mkdir -p "$hp_state_dir"; }
STATE
cat > "$tree/compose/host-preparation/sysctl.sh" <<'SYSCTL'
hp_apply_sysctl() { printf 'sysctl\n' >> "$record"; [ "${FAIL-}" != sysctl ]; }
SYSCTL
cat > "$tree/compose/host-preparation/docker-forward.sh" <<'FORWARD'
hp_apply_docker_forward() { printf 'docker-forward\n' >> "$record"; [ "${FAIL-}" != docker-forward ]; }
FORWARD
cat > "$tree/compose/host-preparation/boot-guard.sh" <<'GUARD'
hp_apply_boot_guard() { printf 'boot-guard\n' >> "$record"; [ "${FAIL-}" != guard ]; }
GUARD
run_case() {
  expected=$1; shift
  : > "$record"
  rm -rf "$record.state" "$record.daemon.json"
  if env record="$record" "$@" sh "$cli" apply >"$temporary/output" 2>&1; then result=ok; else result=fail; fi
  [ "$result" = "$expected" ] || { cat "$temporary/output" >&2; printf 'unexpected result: %s\n' "$result" >&2; exit 1; }
}
expect_calls() {
  expected=$1
  actual=$(cat "$record")
  [ "$actual" = "$expected" ] || { printf 'calls mismatch\nexpected:\n%s\nactual:\n%s\n' "$expected" "$actual" >&2; exit 1; }
}
expect_no_host_changes() {
  [ ! -e "$record.state" ] && [ ! -e "$record.sysctl" ] && [ ! -e "$record.daemon.json" ]
}
run_case ok
[ "$(grep -Fc 'Docker Engine 28.0.0 と Compose plugin を確認しました。' "$temporary/output")" -eq 1 ]
expect_calls 'static
docker-prepare
docker-assess
accounts
state
sysctl
boot-guard
host-reboot
docker-forward'
run_case fail FAIL=static
expect_calls 'static'
run_case fail FAIL=docker
expect_calls 'static
docker-prepare'
expect_no_host_changes
run_case fail ASSESS=compose
expect_calls 'static
docker-prepare
docker-assess'
expect_no_host_changes
run_case fail CONSENT=no
expect_calls 'static
docker-prepare'
expect_no_host_changes
run_case fail TTY=no
expect_calls 'static
docker-prepare'
expect_no_host_changes
run_case fail FAIL=accounts
expect_calls 'static
docker-prepare
docker-assess
accounts'
expect_no_host_changes
run_case fail FAIL=sysctl
expect_calls 'static
docker-prepare
docker-assess
accounts
state
sysctl'
run_case fail FAIL=guard
expect_calls 'static
docker-prepare
docker-assess
accounts
state
sysctl
boot-guard'
run_case fail FAIL=host
expect_calls 'static
docker-prepare
docker-assess
accounts
state
sysctl
boot-guard
host-reboot'
run_case fail FAIL=docker-forward
expect_calls 'static
docker-prepare
docker-assess
accounts
state
sysctl
boot-guard
host-reboot
docker-forward'
printf '%s\n' 'apply-order: OK'
