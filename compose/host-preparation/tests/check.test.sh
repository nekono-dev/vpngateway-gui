#!/bin/sh
# 責務: CLI と Docker 非依存の静的 check を隔離実行で検証する
set -eu
source_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree=$temporary/tree
base=$temporary/base
mkdir -p "$tree/compose/host-preparation" "$base" "$temporary/repo"
cp "$source_root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$source_root/compose/host-preparation/." "$tree/compose/host-preparation/"
printf '%s\n' 'ID=debian' 'VERSION_ID="12"' > "$temporary/os-release"
printf '%s\n' 'LAN_IFACE=eth0' > "$temporary/repo/.env"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
hp_os_release_path='$temporary/os-release'
hp_repo_root='$temporary/repo'
hp_state_dir='$temporary/state'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/sysctl.conf'
hp_boot_guard_unit_path='$temporary/guard.service'
hp_boot_guard_docker_requires_path='$temporary/guard.requires/link'
hp_boot_guard_rules_path='$temporary/guard.nft'
hp_host_ctl_dir='$temporary/host-ctl'
hp_host_reboot_path_unit_path='$temporary/reboot.path'
hp_host_reboot_service_unit_path='$temporary/reboot.service'
hp_host_reboot_exec_path='$temporary/reboot.exec'
hp_host_reboot_enable_link_path='$temporary/reboot.enabled'
hp_host_reboot_spool_dir='$temporary/spool'
EOF

for command in awk cat chmod chown cmp dirname grep head id ip ln mkdir mktemp mv nft readlink rm rmdir sed sleep sort stat sysctl systemctl tr sha256sum; do
  command_path=$(command -v "$command")
  ln -s "$command_path" "$base/$command"
done
rm -f "$base/id" "$base/ip" "$base/nft" "$base/getent" "$base/dpkg-query"
cat > "$base/id" <<'STUB'
#!/bin/sh
[ "$1" = -u ] && { printf '%s\n' "${FIX_UID:-0}"; exit 0; }
exec /usr/bin/id "$@"
STUB
cat > "$base/ip" <<'STUB'
#!/bin/sh
case "$*" in
  '-o route show default') printf '%s\n' 'default via 192.0.2.1 dev eth9' ;;
  'link show dev eth0') [ "${FIX_LINK:-yes}" = yes ] ;;
  *) exit 1 ;;
esac
STUB
cat > "$base/nft" <<'STUB'
#!/bin/sh
[ "${FIX_NFT:-yes}" = yes ] && [ "$1" = -c ]
STUB
cat > "$base/getent" <<'STUB'
#!/bin/sh
case "$1:$2" in
  passwd:10001) [ "${FIX_GETENT_ERROR:-no}" = yes ] && exit 3; [ "${FIX_RESERVED_UID:-no}" = yes ] && { printf '%s\n' 'reserved:x:10001:10001:reserved:/nonexistent:/usr/sbin/nologin'; exit 0; }; exit 2 ;;
  group:10001) [ "${FIX_GETENT_ERROR:-no}" = yes ] && exit 3; [ "${FIX_RESERVED_GID:-no}" = yes ] && { printf '%s\n' 'reserved:x:10001:'; exit 0; }; exit 2 ;;
  *) exit 2 ;;
esac
STUB
cat > "$base/dpkg-query" <<'STUB'
#!/bin/sh
exit 1
STUB
chmod +x "$base/id" "$base/ip" "$base/nft" "$base/getent" "$base/dpkg-query"

run_check() (
  scenario=$1
  expected=$2
  printf '%s\n' 'ID=debian' 'VERSION_ID="12"' > "$temporary/os-release"
  printf '%s\n' 'LAN_IFACE=eth0' > "$temporary/repo/.env"
  missing_command=${scenario#missing:}
  if [ "$missing_command" != "$scenario" ]; then /bin/mv "$base/$missing_command" "$base/$missing_command.hidden"; fi
  FIX_UID=0 FIX_LINK=yes FIX_NFT=yes FIX_RESERVED_UID=no FIX_RESERVED_GID=no FIX_GETENT_ERROR=no
  export FIX_UID FIX_LINK FIX_NFT FIX_RESERVED_UID FIX_RESERVED_GID FIX_GETENT_ERROR
  case "$scenario" in
    unsupported-os) printf '%s\n' 'ID=alpine' 'VERSION_ID="3.20"' > "$temporary/os-release" ;;
    non-root) FIX_UID=1000; export FIX_UID ;;
    nft-fails) FIX_NFT=no; export FIX_NFT ;;
    unset-lan) : > "$temporary/repo/.env" ;;
    malformed-lan) printf '%s\n' 'LAN_IFACE=bad iface' > "$temporary/repo/.env" ;;
    absent-lan) printf '%s\n' 'LAN_IFACE=missing0' > "$temporary/repo/.env" ;;
    uid-conflict|uid-conflict-apply) FIX_RESERVED_UID=yes; export FIX_RESERVED_UID ;;
    gid-conflict|gid-conflict-apply) FIX_RESERVED_GID=yes; export FIX_RESERVED_GID ;;
    uid-lookup-error) FIX_GETENT_ERROR=yes; export FIX_GETENT_ERROR ;;
  esac
  cp "$temporary/repo/.env" "$temporary/env.before"
  action=check
  case "$scenario" in uid-conflict-apply|gid-conflict-apply) action=apply ;; esac
  set +e
  output=$(PATH="$base" /bin/sh "$tree/compose/host-preparation.sh" "$action" 2>&1)
  result=$?
  set -e
  case "$scenario" in
    satisfied)
      [ "$result" -eq 0 ] || { printf '%s\n' "$output" >&2; exit 1; }
      for line in 'OK: 対応 OS' 'OK: root' 'OK: nftables 構文検査' 'OK: LAN_IFACE=eth0' 'Docker 未導入'; do
        printf '%s\n' "$output" | grep -Fq "$line"
      done ;;
    uid-conflict|gid-conflict|uid-lookup-error)
      [ "$result" -ne 0 ] || exit 1
      case "$scenario" in uid-conflict) expected='NG: UID 10001' ;; gid-conflict) expected='NG: GID 10001' ;; *) expected='NG: UID 10001 の使用状況を確認できません' ;; esac
      printf '%s\n' "$output" | /usr/bin/grep -Fq "$expected"
      [ ! -e "$temporary/state/state.json" ] ;;
    uid-conflict-apply|gid-conflict-apply)
      [ "$result" -ne 0 ]
      [ ! -e "$temporary/state/state.json" ] ;;
    *)
      [ "$result" -ne 0 ] || { printf 'case unexpectedly passed: %s\n' "$scenario" >&2; exit 1; }
      if [ "$scenario" = unset-lan ]; then expected='NG: repository root の .env に LAN_IFACE を一つ設定してください'; printf '%s\n' "$output" | grep -Fq '既定ルートの候補: eth9'; fi
      printf '%s\n' "$output" | /usr/bin/grep -Fq "$expected" || { printf 'missing verdict: %s\n%s\n' "$scenario" "$output" >&2; exit 1; } ;;
  esac
  [ ! -e "$temporary/state" ]
  /usr/bin/cmp "$temporary/env.before" "$temporary/repo/.env"
  if [ "$missing_command" != "$scenario" ]; then /bin/mv "$base/$missing_command.hidden" "$base/$missing_command"; fi
)

run_check satisfied ''
run_check unsupported-os 'NG: Debian 12+ または Ubuntu 22.04+ が必要です'
run_check non-root 'NG: root で実行してください'
for command in awk cat chmod chown cmp dirname getent grep head id ip ln mkdir mv nft readlink rm rmdir sed sleep sort stat sysctl systemctl tr; do
  run_check "missing:$command" "NG: 必要コマンドがありません: $command"
done
run_check nft-fails 'NG: nft -c による構文検査ができません'
run_check unset-lan 'NG: repository root の .env に LAN_IFACE を一つ設定してください'
run_check malformed-lan 'NG: LAN_IFACE に使用できない文字が含まれています'
run_check absent-lan 'NG: LAN_IFACE がホストにありません: missing0'
run_check uid-conflict ''
run_check gid-conflict ''
run_check uid-conflict-apply ''
run_check gid-conflict-apply ''
run_check uid-lookup-error ''

# 環境変数で本番パスを差し替えようとしても、攻撃者側の state は作らない。
set +e
PATH="$base" /usr/bin/env HP_REPO_ROOT="$temporary/attacker-repo" HP_OS_RELEASE_PATH="$temporary/attacker-os" HP_STATE_DIR="$temporary/attacker-state" HP_BOOT_GUARD_UNIT_PATH="$temporary/attacker-unit" HP_BOOT_GUARD_RULES_PATH="$temporary/attacker-rules" HP_BOOT_GUARD_DOCKER_REQUIRES_PATH="$temporary/attacker-requires" /bin/sh "$tree/compose/host-preparation.sh" check >/dev/null 2>&1
result=$?
set -e
[ "$result" -eq 0 ]
[ ! -e "$temporary/attacker-state" ]
[ ! -e "$temporary/attacker-unit" ]
[ ! -e "$temporary/attacker-rules" ]
[ ! -e "$temporary/attacker-requires" ]

# 引数表は apply --yes のみを許し、誤用を usage status 2 で拒否する。
for args in 'check --yes' 'status --yes' 'remove --yes' 'apply yes' 'apply --yes --yes' '--yes apply' 'apply extra' 'check extra'; do
  # 引数列を意図的に分割して CLI の順序・重複を列挙する。
  # shellcheck disable=SC2086
  set -- $args
  set +e
  PATH="$base" /bin/sh "$tree/compose/host-preparation.sh" "$@" >/dev/null 2>&1
  result=$?
  set -e
  [ "$result" -eq 2 ] || { printf 'invalid CLI accepted: %s (status %s)\n' "$args" "$result" >&2; exit 1; }
done
set +e
PATH="$base" /usr/bin/env HP_DOCKER_TTY="$temporary/no-tty" /bin/sh "$tree/compose/host-preparation.sh" apply </dev/null >"$temporary/no-tty.out" 2>&1
result=$?
set -e
[ "$result" -ne 0 ]
grep -Fq -- '--yes を指定してください' "$temporary/no-tty.out"
set +e
PATH="$base" /usr/bin/env HP_DOCKER_TTY="$temporary/no-tty" /bin/sh "$tree/compose/host-preparation.sh" apply --yes >"$temporary/yes.out" 2>&1
result=$?
set -e
[ "$result" -ne 0 ]
grep -Fq 'Docker Engine と関連パッケージ（Compose plugin 含む）を導入します。' "$temporary/yes.out"
grep -Fq 'Docker 以外のホスト設定は変更していません' "$temporary/yes.out"
[ ! -e "$temporary/state" ]

# 本番 paths.sh は固定値で、環境変数からパスを受け取らない。
grep -Fq 'hp_os_release_path=/etc/os-release' "$source_root/compose/host-preparation/paths.sh"
grep -Fq 'hp_state_dir=/var/lib/vpngwgui-host-preparation' "$source_root/compose/host-preparation/paths.sh"
printf '%s\n' 'host-preparation static check cases passed'
