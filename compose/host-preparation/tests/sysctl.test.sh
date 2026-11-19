#!/bin/sh
# 責務: sysctl の冪等適用、元値記録、ownership drift と安全な復元を検証する
set -eu

source_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree="$temporary/tree"
mkdir -p "$tree/compose"
cp "$source_root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$source_root/compose/host-preparation" "$tree/compose/host-preparation"
state_dir="$temporary/state"
repo="$temporary/repo"
sysctl_root="$temporary/proc-sys"
mkdir -p "$repo" "$sysctl_root/net/ipv4/conf/all" "$sysctl_root/net/ipv4/conf/default" "$sysctl_root/net/ipv4/conf/eth0"
printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
printf 'net.ipv4.ip_forward = 0\n' > "$sysctl_root/net/ipv4/ip_forward"
printf 'net.ipv4.conf.all.send_redirects = 1\n' > "$sysctl_root/net/ipv4/conf/all/send_redirects"
printf 'net.ipv4.conf.default.send_redirects = 1\n' > "$sysctl_root/net/ipv4/conf/default/send_redirects"
printf 'net.ipv4.conf.eth0.send_redirects = 1\n' > "$sysctl_root/net/ipv4/conf/eth0/send_redirects"
cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: sysctl 試験用の隔離パスを定義する
hp_os_release_path='$temporary/os-release'
hp_repo_root='$repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/sysctl.d/99-vpngwgui-host-preparation.conf'
EOF
mkdir -p "$temporary/sysctl.d"
printf '%s\n' 'ID=debian' 'VERSION_ID="12"' > "$temporary/os-release"
fixtures="$temporary/bin"
mkdir "$fixtures"
cat > "$fixtures/id" <<'EOF'
#!/bin/sh
[ "$1" = -u ] && { printf '0\n'; exit 0; }
exit 1
EOF
cat > "$fixtures/sysctl" <<EOF
#!/bin/sh
set -eu
case "\$1" in
  -n)
    key=\$2
    file='$sysctl_root'/\$(printf '%s' "\$key" | tr . /)
    [ -f "\$file" ] || exit 1
    sed 's/^[^=]*=[[:space:]]*//' "\$file"
    ;;
  -w)
    assignment=\$2
    key=\${assignment%%=*}
    value=\${assignment#*=}
    file='$sysctl_root'/\$(printf '%s' "\$key" | tr . /)
    [ -f "\$file" ] || exit 1
    printf '%s = %s\\n' "\$key" "\$value" > "\$file"
    ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/stat" <<EOF
#!/bin/sh
if [ "\$1" = -c ] && [ "\$2" = '%u:%g %a' ]; then
  case "\$3" in '$state_dir'|'$state_dir'/*|'$temporary/sysctl.d'/*) printf '0:0 %s\\n' \$(/usr/bin/stat -c '%a' "\$3"); exit 0 ;; esac
fi
exec /usr/bin/stat "\$@"
EOF
chmod +x "$fixtures/id" "$fixtures/sysctl" "$fixtures/stat"
export PATH="$fixtures:/usr/bin:/bin"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/paths.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/common.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/state.sh"
# shellcheck disable=SC1091
. "$tree/compose/host-preparation/sysctl.sh"
hp_state_initialize
hp_apply_sysctl
[ "$(cat "$sysctl_root/net/ipv4/ip_forward")" = 'net.ipv4.ip_forward = 1' ]
[ "$(cat "$sysctl_root/net/ipv4/conf/all/send_redirects")" = 'net.ipv4.conf.all.send_redirects = 0' ]
first_state=$(cat "$state_dir/state.json")
printf '%s\n' "$first_state" | grep -Fq '"key":"net.ipv4.ip_forward","original":"0","applied":"1"'
printf '%s\n' "$first_state" | grep -Fq '"key":"net.ipv4.conf.all.send_redirects","original":"1","applied":"0"'
expected_keys="$temporary/expected-keys"
actual_keys="$temporary/actual-keys"
iface=$(sed -n 's/^LAN_IFACE=//p' "$repo/.env")
printf '%s\n' \
  net.ipv4.ip_forward=1 \
  net.ipv4.conf.all.send_redirects=0 \
  net.ipv4.conf.default.send_redirects=0 \
  "net.ipv4.conf.$iface.send_redirects=0" | sort > "$expected_keys"
sed 's/},{/}\n{/g' "$state_dir/state.json" | sed -n 's/.*"key":"\([^"]*\)".*"applied":"\([^"]*\)".*/\1=\2/p' | sort > "$actual_keys"
cmp "$expected_keys" "$actual_keys"
sed '/^#/d' "$hp_sysctl_config_path" | sort > "$temporary/actual-config-keys"
cmp "$expected_keys" "$temporary/actual-config-keys"
hp_apply_sysctl
[ "$(cat "$state_dir/state.json")" = "$first_state" ]
[ "$(grep -c 'net.ipv4.ip_forward=1' "$hp_sysctl_config_path")" -eq 1 ]

# 製品適用値から外部変更された値は apply/remove とも上書きしない。
printf 'net.ipv4.ip_forward = 7\n' > "$sysctl_root/net/ipv4/ip_forward"
if hp_apply_sysctl >"$temporary/drift.out" 2>&1; then
  printf '%s\n' 'apply accepted sysctl ownership drift' >&2
  exit 1
fi
grep -Fq 'net.ipv4.ip_forward' "$temporary/drift.out"
[ "$(cat "$sysctl_root/net/ipv4/ip_forward")" = 'net.ipv4.ip_forward = 7' ]
if hp_remove_sysctl >"$temporary/remove-drift.out" 2>&1; then
  printf '%s\n' 'remove accepted sysctl ownership drift' >&2
  exit 1
fi
grep -Fq 'net.ipv4.ip_forward' "$temporary/remove-drift.out"
[ "$(cat "$sysctl_root/net/ipv4/ip_forward")" = 'net.ipv4.ip_forward = 7' ]

# 外部変更のない対象は元値へ戻し、製品設定ファイルだけを削除する。
printf 'net.ipv4.ip_forward = 1\n' > "$sysctl_root/net/ipv4/ip_forward"
hp_remove_sysctl
[ "$(cat "$sysctl_root/net/ipv4/ip_forward")" = 'net.ipv4.ip_forward = 0' ]
[ "$(cat "$sysctl_root/net/ipv4/conf/all/send_redirects")" = 'net.ipv4.conf.all.send_redirects = 1' ]
[ ! -e "$hp_sysctl_config_path" ]
printf '%s\n' 'host-preparation sysctl cases passed'
