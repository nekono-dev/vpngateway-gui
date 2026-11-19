#!/bin/sh
# 責務: host reboot 依頼の衝突検査、systemd 設置、安全な消費を検証する
set -eu

source_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree="$temporary/tree"
mkdir -p "$tree/compose"
cp -R "$source_root/compose/host-preparation" "$tree/compose/host-preparation"
repo="$temporary/repo"
state_dir="$temporary/state"
host_ctl_dir="$temporary/host-ctl"
systemd_dir="$temporary/systemd"
spool_dir="$temporary/spool"
enable_link="$systemd_dir/multi-user.target.wants/vpngwgui-host-reboot.path"
mkdir -p "$repo" "$systemd_dir" "$temporary/libexec" "$state_dir" "$systemd_dir/multi-user.target.wants"
chmod 0700 "$state_dir"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
printf '%s\n' 'root:x:0:0:root:/root:/bin/sh' > "$temporary/passwd"
printf '%s\n' 'root:x:0:' > "$temporary/group"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: host reboot 試験用の隔離パスを定義する
hp_os_release_path='$temporary/os-release'
hp_host_ctl_dir='$host_ctl_dir'
hp_host_reboot_path_unit_path='$systemd_dir/vpngwgui-host-reboot.path'
hp_host_reboot_service_unit_path='$systemd_dir/vpngwgui-host-reboot.service'
hp_host_reboot_exec_path='$temporary/libexec/vpngwgui-host-reboot'
hp_host_reboot_enable_link_path='$enable_link'
hp_host_reboot_spool_dir='$spool_dir'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
EOF

fixtures="$temporary/bin"
mkdir "$fixtures"
cat > "$fixtures/id" <<'EOF'
#!/bin/sh
[ "$1" = -u ] && { printf '0\n'; exit 0; }
exit 1
EOF
cat > "$fixtures/getent" <<'EOF'
#!/bin/sh
case "$1:$2" in
  passwd:10001) if grep -F '10001' "$FIX_PASSWD"; then exit 0; else exit 2; fi ;;
  group:10001) if grep -F '10001' "$FIX_GROUP"; then exit 0; else exit 2; fi ;;
  *) exit 2 ;;
esac
EOF
cat > "$fixtures/chown" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$fixtures/systemctl" <<EOF
#!/bin/sh
printf '%s\\n' "\$*" >> '$temporary/systemctl.log'
case "\$*" in
  'daemon-reload') exit 0 ;;
  'enable --now vpngwgui-host-reboot.path') [ "\${FIX_FAIL_ENABLE:-no}" = no ] || exit 1; ln -s '$temporary/systemd/vpngwgui-host-reboot.path' '$enable_link'; printf '%s\\n' 'vpngwgui-host-reboot-v1' > '$host_ctl_dir/reboot-request'; chmod 0600 '$host_ctl_dir/reboot-request'; exit 0 ;;
  'disable --now vpngwgui-host-reboot.path') printf '%s\n' 'vpngwgui-host-reboot-v1' > '$host_ctl_dir/reboot-request'; chmod 0600 '$host_ctl_dir/reboot-request'; rm -f '$enable_link'; exit 0 ;;
  'is-enabled vpngwgui-host-reboot.path') printf '%s\\n' enabled ;;
  'reboot') : > '$temporary/rebooted'; exit 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/stat" <<'EOF'
#!/bin/sh
case "$1:$2" in
  -c:'%u:%g %a')
    case "$3" in */host-ctl) printf '10001:10001 700\n'; exit 0;;
      */spool) printf '0:0 700\n'; exit 0;;
      */spool/request.*) printf '%s %s\n' "${FIX_REQUEST_OWNER:-10001:10001}" "$(/usr/bin/stat -c '%a' "$3")"; exit 0;;
      */state) printf '0:0 700\n'; exit 0;;
      */state.json|*/.state.json.*|*/.state-host-reboot*|*/.host-reboot-check*) printf '0:0 600\n'; exit 0;;
      */libexec|*/systemd) printf '0:0 755\n'; exit 0;;
      */reboot-request) printf '%s %s\n' "${FIX_REQUEST_OWNER:-10001:10001}" "$(/usr/bin/stat -c '%a' "$3")"; exit 0;;
      */.reboot-request.tmp.*) printf '%s %s\n' "${FIX_TEMP_OWNER:-10001:10001}" "$(/usr/bin/stat -c '%a' "$3")"; exit 0;;
      */vpngwgui-host-reboot.path|*/vpngwgui-host-reboot.service|*/vpngwgui-host-reboot|*/.vpngwgui-host-reboot*) printf '0:0 %s\n' "$(/usr/bin/stat -c '%a' "$3")"; exit 0;;
    esac
    ;;
esac
exec /usr/bin/stat "$@"
EOF
cat > "$fixtures/mv" <<'EOF'
#!/bin/sh
case "${FIX_MV_RACE:-}" in
  before)
    [ "$1" = -- ] && shift
    request=$1
    /bin/rm -f "$request"
    /bin/ln -s "$FIX_RACE_TARGET" "$request"
    exec /bin/mv "$@"
    ;;
  after)
    [ "$1" = -- ] && shift
    request=$1
    /bin/mv "$@" || exit $?
    printf '%s\\n' 'attacker payload' > "$request"
    /bin/chmod 0600 "$request"
    exit 0
    ;;
  concurrent) /bin/sleep 0.1 ;;
esac
exec /bin/mv "$@"
EOF
chmod +x "$fixtures"/*
export PATH="$fixtures:/usr/bin:/bin"
export FIX_PASSWD="$temporary/passwd" FIX_GROUP="$temporary/group"

# shellcheck disable=SC1091
. "$tree/compose/host-preparation/paths.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/common.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/state.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/host-reboot.sh"
HP_HOST_CTL_DIR="$temporary/attacker-host-ctl"
HP_HOST_REBOOT_PATH_UNIT_PATH="$temporary/attacker.path"
HP_HOST_REBOOT_SKIP_ACCOUNT_CHECK=yes
export HP_HOST_CTL_DIR HP_HOST_REBOOT_PATH_UNIT_PATH HP_HOST_REBOOT_SKIP_ACCOUNT_CHECK

# UID と GID の既存利用は独立して拒否される。
(
  printf '%s\n' 'reserved:x:10001:10001:reserved:/nonexistent:/usr/sbin/nologin' > "$temporary/passwd-uid"
  printf '%s\n' 'root:x:0:' > "$temporary/group-uid"
  FIX_PASSWD="$temporary/passwd-uid" FIX_GROUP="$temporary/group-uid"; export FIX_PASSWD FIX_GROUP
  if hp_check_host_reboot_accounts > "$temporary/uid-conflict.out" 2>&1; then
    printf '%s\n' 'UID 10001 collision was accepted' >&2
    exit 1
  fi
  grep -Fq 'UID 10001' "$temporary/uid-conflict.out"
)
(
  printf '%s\n' 'root:x:0:0:root:/root:/bin/sh' > "$temporary/passwd-gid"
  printf '%s\n' 'reserved:x:10001:' > "$temporary/group-gid"
  FIX_PASSWD="$temporary/passwd-gid" FIX_GROUP="$temporary/group-gid"; export FIX_PASSWD FIX_GROUP
  if hp_check_host_reboot_accounts > "$temporary/gid-conflict.out" 2>&1; then
    printf '%s\n' 'GID 10001 collision was accepted' >&2
    exit 1
  fi
  grep -Fq 'GID 10001' "$temporary/gid-conflict.out"
)
hp_check_host_reboot_accounts

# apply は専用 directory と固定された path/service/validator を設置して有効化する。
hp_state_initialize
FIX_FAIL_ENABLE=yes; export FIX_FAIL_ENABLE
if hp_apply_host_reboot > "$temporary/partial-apply.out" 2>&1; then
  printf '%s\n' 'injected path-unit enable failure was ignored' >&2
  exit 1
fi
grep -Fq '"host_reboot":{"status":"pending"' "$state_dir/state.json"
[ -e "$hp_host_reboot_exec_path" ]
[ -e "$hp_host_reboot_path_unit_path" ]
unset FIX_FAIL_ENABLE
hp_apply_host_reboot
[ -d "$host_ctl_dir" ]
[ "$(stat -c '%u:%g %a' "$host_ctl_dir")" = '10001:10001 700' ]
[ "$hp_host_ctl_dir" = "$host_ctl_dir" ]
[ ! -e "$temporary/attacker-host-ctl" ]
[ ! -e "$temporary/attacker.path" ]
grep -Fq "PathExists=$host_ctl_dir/reboot-request" "$hp_host_reboot_path_unit_path"
grep -Fq "ExecStart=/bin/sh $hp_host_reboot_exec_path $host_ctl_dir/reboot-request $spool_dir" "$hp_host_reboot_service_unit_path"
grep -Fq 'systemctl reboot' "$hp_host_reboot_exec_path"
grep -Fq 'enable --now vpngwgui-host-reboot.path' "$temporary/systemctl.log"
grep -Fq '"host_reboot":{"status":"applied"' "$state_dir/state.json"
[ -e "$host_ctl_dir/reboot-request" ]
[ ! -e "$temporary/rebooted" ]
rm -f "$host_ctl_dir/reboot-request"

request="$host_ctl_dir/reboot-request"
validator="$hp_host_reboot_exec_path"
write_request() {
  printf '%s\n' 'vpngwgui-host-reboot-v1' > "$request"
  chmod 0600 "$request"
}
run_rejected() (
  label=$1
  case_dir="$temporary/request-$label"
  mkdir "$case_dir"
  request="$case_dir/reboot-request"
  write_request
  case "$label" in
    symlink)
      target="$temporary/untouched"
      printf '%s\n' 'keep' > "$target"
      rm -f "$request"
      ln -s "$target" "$request"
      ;;
    non-regular)
      rm -f "$request"
      mkfifo "$request"
      ;;
    empty-directory)
      rm -f "$request"
      mkdir "$request"
      ;;
    non-empty-directory)
      rm -f "$request"
      mkdir -p "$request/nested"
      printf '%s\n' 'discard me' > "$request/nested/payload"
      printf '%s\n' 'keep outside' > "$temporary/outside-target"
      ln -s "$temporary/outside-target" "$request/nested/outside-link"
      ;;
    wrong-owner) FIX_REQUEST_OWNER=10000:10001; export FIX_REQUEST_OWNER ;;
    wrong-mode) chmod 0644 "$request" ;;
    wrong-content) printf 'systemctl /bin/touch %s/arbitrary-command-ran\n' "$temporary" > "$request" ;;
  esac
  rm -f "$temporary/rebooted"
  if "$validator" "$request" "$spool_dir" > "$temporary/reject-$label.out" 2>&1; then
    printf 'invalid request accepted: %s\n' "$label" >&2
    exit 1
  fi
  grep -Fq '拒否' "$temporary/reject-$label.out"
  [ ! -e "$request" ] && [ ! -L "$request" ]
  [ ! -e "$temporary/rebooted" ]
  [ ! -e "$temporary/arbitrary-command-ran" ]
  if [ "$label" = symlink ]; then
    target_content=$(cat "$target")
    [ "$target_content" = keep ]
  fi
)
run_rejected symlink
run_rejected non-regular
run_rejected empty-directory
run_rejected non-empty-directory
[ -z "$(find "$spool_dir" -mindepth 1 -print -quit 2>/dev/null || :)" ]
[ "$(cat "$temporary/outside-target")" = 'keep outside' ]
run_rejected wrong-owner
run_rejected wrong-mode
run_rejected wrong-content

# consume 直前に pathname が symlink へ置き換わっても、リンク先は読み書きしない。
mkdir "$temporary/request-symlink-race"
request="$temporary/request-symlink-race/reboot-request"
write_request
printf '%s\n' keep > "$temporary/race-target"
FIX_MV_RACE=before FIX_RACE_TARGET="$temporary/race-target"; export FIX_MV_RACE FIX_RACE_TARGET
if "$validator" "$request" "$spool_dir" > "$temporary/symlink-race.out" 2>&1; then exit 1; fi
[ "$(cat "$temporary/race-target")" = keep ]
[ ! -e "$temporary/rebooted" ]
unset FIX_MV_RACE FIX_RACE_TARGET

# 元 pathname を consume 後に差し替えても、判定は root spool の内容で行う。
mkdir "$temporary/request-replacement-race"
request="$temporary/request-replacement-race/reboot-request"
write_request
FIX_MV_RACE=after; export FIX_MV_RACE
rm -f "$temporary/rebooted"
"$validator" "$request" "$spool_dir" > "$temporary/replacement-race.out"
[ -f "$temporary/rebooted" ]
[ -e "$request" ]
rm -f "$request" "$temporary/rebooted"
unset FIX_MV_RACE

# 同じ要求の並行処理は一方だけが消費する。
mkdir "$temporary/request-concurrent"
request="$temporary/request-concurrent/reboot-request"
write_request
FIX_MV_RACE=concurrent; export FIX_MV_RACE
rm -f "$temporary/rebooted"
"$validator" "$request" "$spool_dir" > "$temporary/concurrent-one.out" 2>&1 & first_pid=$!
"$validator" "$request" "$spool_dir" > "$temporary/concurrent-two.out" 2>&1 & second_pid=$!
wait "$first_pid"
wait "$second_pid"
[ -f "$temporary/rebooted" ]
unset FIX_MV_RACE

mkdir "$temporary/request-valid"
request="$temporary/request-valid/reboot-request"
write_request
rm -f "$temporary/rebooted"
"$validator" "$request" "$spool_dir" > "$temporary/accepted.out"
[ ! -e "$request" ]
[ -f "$temporary/rebooted" ]
# remove は drift があれば先行して確認し、対象へ触れない。
cp "$hp_host_reboot_service_unit_path" "$temporary/service.backup"
printf '%s\n' 'foreign edit' >> "$hp_host_reboot_service_unit_path"
if hp_remove_host_reboot > "$temporary/remove-conflict.out" 2>&1; then
  printf '%s\n' 'drifted service unit was removed' >&2
  exit 1
fi
[ -L "$enable_link" ]
[ -e "$hp_host_reboot_path_unit_path" ]
cp "$temporary/service.backup" "$hp_host_reboot_service_unit_path"
chmod 0644 "$hp_host_reboot_service_unit_path"

# disable 中に届いた依頼も path watcher を止めた後に破棄され、再起動しない。
rm -f "$temporary/rebooted"
hp_remove_host_reboot
[ ! -e "$hp_host_ctl_dir" ]
[ ! -e "$hp_host_reboot_spool_dir" ]
[ ! -e "$hp_host_reboot_exec_path" ]
[ ! -e "$hp_host_reboot_path_unit_path" ]
[ ! -e "$hp_host_reboot_service_unit_path" ]
[ ! -L "$enable_link" ]
[ ! -e "$temporary/rebooted" ]
if grep -Fq '"host_reboot"' "$state_dir/state.json"; then exit 1; fi
# hard kill で残った製品一時ファイルは status/preflight で識別し、remove でだけ掃除する。
printf '%s\n' '{"version":1}' > "$state_dir/state.json"
chmod 0600 "$state_dir/state.json"
hp_apply_host_reboot
temp_file="$host_ctl_dir/.reboot-request.tmp.12345.abcdef0123456789abcdef0123456789"
printf '%s' partial > "$temp_file"
chmod 0600 "$temp_file"
. "$tree/compose/host-preparation/remove.sh"
[ "$(hp_host_reboot_preflight)" = PENDING-CLEANABLE ]
. "$tree/compose/host-preparation/status.sh"
hp_status_host_reboot > "$temporary/temp-status.out"
grep -Fq 'pending-cleanable: host reboot temporary file' "$temporary/temp-status.out"
rm -f "$temp_file"

# 一時名でも symlink・別 owner・directory は競合として保持する。
for invalid in symlink wrong-owner wrong-mode directory foreign-name; do
  invalid_path="$host_ctl_dir/.reboot-request.tmp.12345.abcdef0123456789abcdef0123456789"
  case "$invalid" in
    symlink) printf 'target\n' > "$temporary/temp-target"; ln -s "$temporary/temp-target" "$invalid_path" ;;
    wrong-owner) printf '%s' partial > "$invalid_path"; chmod 0600 "$invalid_path"; FIX_TEMP_OWNER=10000:10001; export FIX_TEMP_OWNER ;;
    wrong-mode) printf '%s' partial > "$invalid_path"; chmod 0644 "$invalid_path" ;;
    directory) mkdir "$invalid_path" ;;
    foreign-name) invalid_path="$host_ctl_dir/.reboot-request.tmp.12345.not-hex"; printf '%s' partial > "$invalid_path"; chmod 0600 "$invalid_path" ;;
  esac
  if hp_host_reboot_precheck; then printf 'unsafe temp accepted: %s\n' "$invalid" >&2; exit 1; fi
  [ -e "$invalid_path" ] || [ -L "$invalid_path" ]
  rm -rf "$invalid_path"
  unset FIX_TEMP_OWNER
done
printf '%s' partial > "$temp_file"
chmod 0600 "$temp_file"
hp_remove_host_reboot
[ ! -e "$temp_file" ]
printf '%s\n' 'host-preparation host reboot cases passed'

