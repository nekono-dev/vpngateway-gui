#!/bin/sh
# 責務: host-preparation の status drift 判定と remove の部分失敗報告を検証する
# shellcheck disable=SC2030,SC2031
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
status_case() (
tree="$temporary/tree"
mkdir -p "$tree/compose"
cp "$root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$root/compose/host-preparation" "$tree/compose/host-preparation"
state_dir="$temporary/state"
repo="$temporary/repo"
mkdir -m 0700 "$state_dir" "$repo" "$temporary/bin"
printf '%s\n' 'LAN_IFACE=eth1' > "$repo/.env"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: テスト用の隔離パスを定義する
hp_os_release_path='$temporary/os-release'
hp_repo_root='$repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/sysctl.conf'
hp_boot_guard_unit_path='$temporary/boot-guard.service'
hp_boot_guard_docker_requires_path='$temporary/docker.requires/vpngwgui-boot-guard.service'
hp_boot_guard_rules_path='$temporary/boot-guard.nft'
hp_host_ctl_dir='$temporary/host-ctl'
hp_host_reboot_path_unit_path='$temporary/host-reboot.path'
hp_host_reboot_service_unit_path='$temporary/host-reboot.service'
hp_host_reboot_exec_path='$temporary/host-reboot'
hp_host_reboot_enable_link_path='$temporary/host-reboot.enabled'
hp_host_reboot_spool_dir='$temporary/host-reboot-spool'
EOF
cat > "$temporary/bin/stat" <<'EOF'
#!/bin/sh
case "$*" in
  *"$STATE_DIR"*)
    if [ "$1" = -c ] && [ "$2" = '%u:%g %a' ]; then
      case "$3" in "$STATE_PATH") printf '%s\n' '0:0 600' ;; *) printf '%s\n' '0:0 700' ;; esac
      exit 0
    fi
    ;;
esac
exec /usr/bin/stat "$@"
EOF
chmod +x "$temporary/bin/stat"
export PATH="$temporary/bin:/usr/bin:/bin" STATE_DIR="$state_dir" STATE_PATH="$state_dir/state.json"
cat > "$state_dir/state.json" <<'EOF'
{"version":1,"sysctl":[{"key":"net.ipv4.ip_forward","original":"0","applied":"1"}],"boot_guard":{"interface":"eth0","status":"applied"},"host_reboot":{"status":"applied","directory":"/tmp/host-ctl","directory_identity":"missing","helper":"/tmp/host-reboot","path_unit":"/tmp/host-reboot.path","service_unit":"/tmp/host-reboot.service","enable_link":"/tmp/host-reboot.enabled","spool":"/tmp/host-reboot-spool"}}
EOF
chmod 0600 "$state_dir/state.json"
cp "$repo/.env" "$temporary/env.before"
cp "$state_dir/state.json" "$temporary/state.before"
# 破損・未知形式は status/remove のどちらも拒否し、state を保持する。
for malformed in '{"version":1,"sysctl":[' 'garbage' '{"version":1,"unknown":true}' \
  '{"version":1,"version":1}' \
  '{"version":1,"boot_guard":{"interface":"eth0","status":"broken"}}' \
  '{"version":0}' '{"version":2}'; do
  printf '%s\n' "$malformed" > "$state_dir/state.json"
  cp "$state_dir/state.json" "$temporary/malformed.before"
  for operation in status remove; do
    set +e
    /bin/sh "$tree/compose/host-preparation.sh" "$operation" > "$temporary/malformed.out" 2>&1
    malformed_result=$?
    set -e
    if [ "$malformed_result" -eq 0 ]; then
      printf 'malformed state unexpectedly accepted by %s: %s\n' "$operation" "$malformed" >&2
      exit 1
    fi
    grep -Eq 'state の形式が不正|state key が重複' "$temporary/malformed.out" || { cat "$temporary/malformed.out" >&2; exit 1; }
    cmp "$temporary/malformed.before" "$state_dir/state.json"
  done
done
cp "$temporary/state.before" "$state_dir/state.json"
set +e
/bin/sh "$tree/compose/host-preparation.sh" status > "$temporary/status.out" 2>&1
status_result=$?
set -e
if [ "$status_result" -eq 0 ]; then
  printf '%s\n' 'status unexpectedly accepted drifted ownership state' >&2
  exit 1
fi
grep -Fq 'drifted: LAN_IFACE (.env=eth1, state=eth0)' "$temporary/status.out" || { cat "$temporary/status.out" >&2; exit 1; }
cmp "$temporary/env.before" "$repo/.env"
cmp "$temporary/state.before" "$state_dir/state.json"

)

# remove は各所有 handler を試し、成功済み変更と失敗段階を報告する。
remove_case() (
tree="$temporary/remove-tree"
state_dir="$temporary/remove-state"
repo="$temporary/remove-repo"
mkdir -p "$tree/compose" "$temporary/remove-bin"
cp "$temporary/bin/stat" "$temporary/remove-bin/stat"
cp "$root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$root/compose/host-preparation" "$tree/compose/host-preparation"
mkdir -m 0700 "$state_dir" "$repo"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: テスト用の隔離パスを定義する
hp_os_release_path='$temporary/remove-os-release'
hp_repo_root='$repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/remove-sysctl.conf'
hp_boot_guard_unit_path='$temporary/remove-boot-guard.service'
hp_boot_guard_docker_requires_path='$temporary/remove-docker.requires/vpngwgui-boot-guard.service'
hp_boot_guard_rules_path='$temporary/remove-boot-guard.nft'
hp_host_ctl_dir='$temporary/remove-host-ctl'
hp_host_reboot_path_unit_path='$temporary/remove-host-reboot.path'
hp_host_reboot_service_unit_path='$temporary/remove-host-reboot.service'
hp_host_reboot_exec_path='$temporary/remove-host-reboot'
hp_host_reboot_enable_link_path='$temporary/remove-host-reboot.enabled'
hp_host_reboot_spool_dir='$temporary/remove-host-reboot-spool'
EOF
cat > "$state_dir/state.json" <<'EOF'
{"version":1,"sysctl":[{"key":"net.ipv4.ip_forward","original":"0","applied":"1"}],"boot_guard":{"interface":"eth0","status":"applied"},"host_reboot":{"status":"applied","directory":"/tmp/host-ctl","directory_identity":"missing","helper":"/tmp/host-reboot","path_unit":"/tmp/host-reboot.path","service_unit":"/tmp/host-reboot.service","enable_link":"/tmp/host-reboot.enabled","spool":"/tmp/host-reboot-spool"}}
EOF
chmod 0600 "$state_dir/state.json"
export PATH="$temporary/remove-bin:/usr/bin:/bin" STATE_DIR="$state_dir" STATE_PATH="$state_dir/state.json"
cat > "$temporary/remove-test.sh" <<EOF
#!/bin/sh
set -eu
. '$tree/compose/host-preparation/paths.sh'
. '$tree/compose/host-preparation/common.sh'
. '$tree/compose/host-preparation/state.sh'
. '$tree/compose/host-preparation/sysctl.sh'
. '$tree/compose/host-preparation/boot-guard.sh'
. '$tree/compose/host-preparation/host-reboot.sh'
. '$tree/compose/host-preparation/status.sh'
. '$tree/compose/host-preparation/remove.sh'
hp_sysctl_preflight() { printf '%s\\n' ABSENT; }
hp_host_reboot_preflight() { printf '%s\\n' ABSENT; }
hp_boot_guard_preflight() { printf '%s\\n' 'CONFLICT: foreign guard retained'; }
hp_remove_sysctl() { printf '%s\\n' 'MUTATED sysctl'; return 0; }
hp_remove_boot_guard() { printf '%s\\n' 'MUTATED boot guard'; return 0; }
hp_remove_host_reboot() { printf '%s\\n' 'MUTATED host reboot'; return 0; }
hp_remove
EOF
if /bin/sh "$temporary/remove-test.sh" > "$temporary/remove.out" 2>&1; then
  printf '%s\n' 'remove unexpectedly accepted a component ownership conflict' >&2
  exit 1
fi
grep -Fq 'ownership conflict: boot_guard' "$temporary/remove.out" || { cat "$temporary/remove.out" >&2; exit 1; }
if grep -Fq 'MUTATED' "$temporary/remove.out"; then cat "$temporary/remove.out" >&2; exit 1; fi
grep -Fq '変更を開始しませんでした' "$temporary/remove.out"
)
status_case
remove_case

# remove は status drift では停止せず、ABSENT/PENDING-CLEANABLE/OWNED を解除へ進める。
remove_classification_case() (
tree="$temporary/classification-tree"
state_dir="$temporary/classification-state"
repo="$temporary/classification-repo"
mkdir -p "$tree/compose"
cp "$root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$root/compose/host-preparation" "$tree/compose/host-preparation"
mkdir -m 0700 "$state_dir" "$repo"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: テスト用の隔離パスを定義する
hp_os_release_path='$temporary/class-os-release'
hp_repo_root='$repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/class-sysctl.conf'
hp_boot_guard_unit_path='$temporary/class-boot-guard.service'
hp_boot_guard_docker_requires_path='$temporary/class-docker.requires/vpngwgui-boot-guard.service'
hp_boot_guard_rules_path='$temporary/class-boot-guard.nft'
hp_host_ctl_dir='$temporary/class-host-ctl'
hp_host_reboot_path_unit_path='$temporary/class-host-reboot.path'
hp_host_reboot_service_unit_path='$temporary/class-host-reboot.service'
hp_host_reboot_exec_path='$temporary/class-host-reboot'
hp_host_reboot_enable_link_path='$temporary/class-host-reboot.enabled'
hp_host_reboot_spool_dir='$temporary/class-host-reboot-spool'
EOF
cat > "$state_dir/state.json" <<'EOF'
{"version":1,"sysctl":[{"key":"net.ipv4.ip_forward","original":"0","applied":"1"}],"boot_guard":{"interface":"eth0","status":"pending"},"host_reboot":{"status":"pending","directory":"/tmp/host-ctl","directory_identity":"missing","helper":"/tmp/host-reboot","path_unit":"/tmp/host-reboot.path","service_unit":"/tmp/host-reboot.service","enable_link":"/tmp/host-reboot.enabled","spool":"/tmp/host-reboot-spool"}}
EOF
chmod 0600 "$state_dir/state.json"
export PATH="$temporary/remove-bin:/usr/bin:/bin" STATE_DIR="$state_dir" STATE_PATH="$state_dir/state.json"
cat > "$temporary/classification-test.sh" <<EOF
#!/bin/sh
set -eu
. '$tree/compose/host-preparation/paths.sh'
. '$tree/compose/host-preparation/common.sh'
. '$tree/compose/host-preparation/state.sh'
. '$tree/compose/host-preparation/sysctl.sh'
. '$tree/compose/host-preparation/boot-guard.sh'
. '$tree/compose/host-preparation/host-reboot.sh'
. '$tree/compose/host-preparation/status.sh'
. '$tree/compose/host-preparation/remove.sh'
hp_sysctl_preflight() { printf '%s\\n' ABSENT; }
hp_host_reboot_preflight() { printf '%s\\n' PENDING-CLEANABLE; }
hp_boot_guard_preflight() { printf '%s\\n' OWNED; }
hp_remove_host_reboot() { printf '%s\\n' 'removed host reboot'; }
hp_remove_sysctl() { printf '%s\\n' 'removed sysctl'; }
hp_remove_boot_guard() { printf '%s\\n' 'removed boot guard'; }
hp_remove
hp_remove
EOF
if /bin/sh "$temporary/classification-test.sh" > "$temporary/classification.out" 2>&1; then
  :
else
  cat "$temporary/classification.out" >&2
  exit 1
fi
grep -Fq '解除済み: host_reboot' "$temporary/classification.out"
grep -Fq '解除済み: sysctl' "$temporary/classification.out"
grep -Fq '解除済み: boot_guard' "$temporary/classification.out"
[ ! -e "$state_dir/state.json" ]
)

remove_conflict_classification_case() (
tree="$temporary/conflict-tree"
state_dir="$temporary/conflict-state"
repo="$temporary/conflict-repo"
mkdir -p "$tree/compose"
cp "$root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$root/compose/host-preparation" "$tree/compose/host-preparation"
mkdir -m 0700 "$state_dir" "$repo"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: テスト用の隔離パスを定義する
hp_os_release_path='$temporary/conflict-os-release'
hp_repo_root='$repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/conflict-sysctl.conf'
hp_boot_guard_unit_path='$temporary/conflict-boot-guard.service'
hp_boot_guard_docker_requires_path='$temporary/conflict-docker.requires/vpngwgui-boot-guard.service'
hp_boot_guard_rules_path='$temporary/conflict-boot-guard.nft'
hp_host_ctl_dir='$temporary/conflict-host-ctl'
hp_host_reboot_path_unit_path='$temporary/conflict-host-reboot.path'
hp_host_reboot_service_unit_path='$temporary/conflict-host-reboot.service'
hp_host_reboot_exec_path='$temporary/conflict-host-reboot'
hp_host_reboot_enable_link_path='$temporary/conflict-host-reboot.enabled'
hp_host_reboot_spool_dir='$temporary/conflict-host-reboot-spool'
EOF
cat > "$state_dir/state.json" <<'EOF'
{"version":1,"sysctl":[{"key":"net.ipv4.ip_forward","original":"0","applied":"1"}],"host_reboot":{"status":"pending","directory":"/tmp/host-ctl","directory_identity":"missing","helper":"/tmp/host-reboot","path_unit":"/tmp/host-reboot.path","service_unit":"/tmp/host-reboot.service","enable_link":"/tmp/host-reboot.enabled","spool":"/tmp/host-reboot-spool"},"boot_guard":{"interface":"eth0","status":"pending"}}
EOF
chmod 0600 "$state_dir/state.json"
export PATH="$temporary/remove-bin:/usr/bin:/bin" STATE_DIR="$state_dir" STATE_PATH="$state_dir/state.json"
cat > "$temporary/conflict-test.sh" <<EOF
#!/bin/sh
set -eu
. '$tree/compose/host-preparation/paths.sh'
. '$tree/compose/host-preparation/common.sh'
. '$tree/compose/host-preparation/state.sh'
. '$tree/compose/host-preparation/sysctl.sh'
. '$tree/compose/host-preparation/boot-guard.sh'
. '$tree/compose/host-preparation/host-reboot.sh'
. '$tree/compose/host-preparation/status.sh'
. '$tree/compose/host-preparation/remove.sh'
hp_sysctl_preflight() { printf '%s\\n' ABSENT; }
hp_host_reboot_preflight() { printf '%s\\n' OWNED; }
hp_boot_guard_preflight() { printf '%s\\n' 'CONFLICT: foreign table content'; }
hp_remove_sysctl() { printf '%s\\n' 'MUTATED sysctl'; }
hp_remove_host_reboot() { printf '%s\\n' 'MUTATED host reboot'; }
hp_remove_boot_guard() { printf '%s\\n' 'MUTATED boot guard'; }
hp_remove
EOF
if /bin/sh "$temporary/conflict-test.sh" > "$temporary/conflict.out" 2>&1; then
  printf '%s\n' 'remove unexpectedly accepted a later handler conflict' >&2
  exit 1
fi
grep -Fq 'CONFLICT: foreign table content' "$temporary/conflict.out"
if grep -Fq 'MUTATED' "$temporary/conflict.out"; then cat "$temporary/conflict.out" >&2; exit 1; fi
cmp "$state_dir/state.json" <<'EOF'
{"version":1,"sysctl":[{"key":"net.ipv4.ip_forward","original":"0","applied":"1"}],"host_reboot":{"status":"pending","directory":"/tmp/host-ctl","directory_identity":"missing","helper":"/tmp/host-reboot","path_unit":"/tmp/host-reboot.path","service_unit":"/tmp/host-reboot.service","enable_link":"/tmp/host-reboot.enabled","spool":"/tmp/host-reboot-spool"},"boot_guard":{"interface":"eth0","status":"pending"}}
EOF
)

sysctl_preflight_original_case() (
tree="$temporary/sysctl-tree"
state_dir="$temporary/sysctl-state"
repo="$temporary/sysctl-repo"
mkdir -p "$tree/compose"
cp -R "$root/compose/host-preparation" "$tree/compose/host-preparation"
mkdir -m 0700 "$state_dir" "$repo"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: テスト用の隔離パスを定義する
hp_os_release_path='$temporary/preflight-os-release'
hp_repo_root='$repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/preflight-sysctl.conf'
hp_boot_guard_unit_path='$temporary/preflight-boot-guard.service'
hp_boot_guard_docker_requires_path='$temporary/preflight-docker.requires/vpngwgui-boot-guard.service'
hp_boot_guard_rules_path='$temporary/preflight-boot-guard.nft'
hp_host_ctl_dir='$temporary/preflight-host-ctl'
hp_host_reboot_path_unit_path='$temporary/preflight-host-reboot.path'
hp_host_reboot_service_unit_path='$temporary/preflight-host-reboot.service'
hp_host_reboot_exec_path='$temporary/preflight-host-reboot'
hp_host_reboot_enable_link_path='$temporary/preflight-host-reboot.enabled'
hp_host_reboot_spool_dir='$temporary/preflight-host-reboot-spool'
EOF
cat > "$state_dir/state.json" <<'EOF'
{"version":1,"sysctl":[{"key":"net.ipv4.ip_forward","original":"0","applied":"1"}]}
EOF
chmod 0600 "$state_dir/state.json"
cat > "$temporary/sysctl-fixture" <<'EOF'
#!/bin/sh
case "$*" in *net.ipv4.ip_forward*) cat "$SYSCTL_VALUE_FILE" ;; *) exit 1 ;; esac
EOF
chmod +x "$temporary/sysctl-fixture"
export PATH="$temporary/remove-bin:/usr/bin:/bin" SYSCTL_VALUE_FILE="$temporary/sysctl-value"
cat > "$temporary/preflight-test.sh" <<PRECHECK_SCRIPT
#!/bin/sh
set -eu
. '$tree/compose/host-preparation/paths.sh'
. '$tree/compose/host-preparation/common.sh'
. '$tree/compose/host-preparation/state.sh'
. '$tree/compose/host-preparation/sysctl.sh'
. '$tree/compose/host-preparation/boot-guard.sh'
. '$tree/compose/host-preparation/host-reboot.sh'
. '$tree/compose/host-preparation/status.sh'
. '$tree/compose/host-preparation/remove.sh'
sysctl() { '$temporary/sysctl-fixture' "\$@"; }
printf '%s\\n' 0 > "\$SYSCTL_VALUE_FILE"
[ "\$(hp_sysctl_preflight)" = ABSENT ]
printf '%s\\n' 1 > "\$SYSCTL_VALUE_FILE"
[ "\$(hp_sysctl_preflight)" = OWNED ]
printf '%s\\n' 2 > "\$SYSCTL_VALUE_FILE"
case "\$(hp_sysctl_preflight)" in CONFLICT:*) ;; *) exit 1 ;; esac
PRECHECK_SCRIPT
/bin/sh "$temporary/preflight-test.sh"
)

remove_classification_case
remove_conflict_classification_case
sysctl_preflight_original_case

# status/remove が共有する所有検証器は nft 1.0.9 の実 listing を受理する。
real_listing_case() (
  . "$root/compose/host-preparation/boot-guard.sh"
  . "$root/compose/host-preparation/status.sh"
  . "$root/compose/host-preparation/remove.sh"
  real_listing_dir="$root/compose/host-preparation/tests/fixtures/nft-1.0.9"
  real_listing_path=
  nft() { cat "$real_listing_path"; }
  for real_state in block lease lease-refreshed off; do
    real_listing_path="$real_listing_dir/$real_state.txt"
    table_output=$(nft list table inet vpngwgui_guard)
    hp_boot_guard_verify_resources
    hp_boot_guard_verify_owned_table acclan0 || {
      printf 'RED: status/remove rejected real nft 1.0.9 %s listing\n' "$real_state" >&2
      exit 1
    }
  done
)
real_listing_case
printf '%s\n' 'host-preparation status/remove cases passed'
