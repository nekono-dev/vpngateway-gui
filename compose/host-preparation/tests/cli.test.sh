#!/bin/sh
# 責務: host-preparation CLI の引数契約を検証する
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree="$temporary/tree"
mkdir -p "$tree/compose"
cp "$root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$root/compose/host-preparation" "$tree/compose/host-preparation"
cli="$tree/compose/host-preparation.sh"
common="$tree/compose/host-preparation/common.sh"
mkdir -p "$temporary/repo"
printf '%s\n' 'ID=debian' 'VERSION_ID="12"' > "$temporary/os-release"
printf '%s\n' 'LAN_IFACE=eth0' > "$temporary/repo/.env"
configure_paths() {
  STATE_DIR=$state_dir
  export STATE_DIR
  mkdir -p "$temporary/sysctl.d"
  cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: テスト用の隔離パスを定義する
hp_os_release_path='$temporary/os-release'
hp_repo_root='$temporary/repo'
hp_state_dir='$state_dir'
hp_docker_daemon_config_path='$temporary/daemon.json'
hp_sysctl_config_path='$temporary/sysctl.d/$(basename "$state_dir").conf'
hp_boot_guard_unit_path='$temporary/systemd/$(basename "$state_dir").service'
hp_boot_guard_docker_requires_path='$temporary/systemd/$(basename "$state_dir").requires/vpngwgui-boot-guard.service'
hp_boot_guard_rules_path='$temporary/etc/vpngwgui/$(basename "$state_dir").nft'
EOF
  mkdir -p "$temporary/systemd" "$temporary/etc/vpngwgui"
}
state_dir="$temporary/state"
configure_paths
sh "$cli" --help >/dev/null
if sh "$cli" update >/dev/null 2>&1; then
  printf '%s\n' 'CLI accepted an unsupported command' >&2
  exit 1
fi

# shellcheck disable=SC1090,SC1091
. "$common"
printf 'LAN_IFACE=eth0\n' > "$temporary/.env"
[ "$(hp_read_lan_iface "$temporary")" = eth0 ]
printf 'LAN_IFACE="lan.1"\n' > "$temporary/.env"
[ "$(hp_read_lan_iface "$temporary")" = lan.1 ]
printf 'LAN_IFACE=eth0\nLAN_IFACE=eth1\n' > "$temporary/.env"
if hp_read_lan_iface "$temporary" >/dev/null 2>&1; then
  printf '%s\n' 'LAN_IFACE duplicate was accepted' >&2
  exit 1
fi
fixtures="$temporary/bin"
mkdir -p "$fixtures"
cat > "$fixtures/sysctl" <<'EOF'
#!/bin/sh
case "$1" in
  -n) case "$2" in net.ipv4.ip_forward) printf '1\n' ;; *) printf '0\n' ;; esac ;;
  -w) exit 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/id" <<'EOF'
#!/bin/sh
case "$1" in
  -u) printf '%s\n' 0 ;;
  -g) printf '%s\n' 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/ip" <<'EOF'
#!/bin/sh
case "$*" in
  '-o route show default') printf '%s\n' 'default via 192.0.2.1 dev eth0' ;;
  'link show dev eth0') exit 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/docker" <<'EOF'
#!/bin/sh
case "$*" in
  'info --format {{json .SecurityOptions}}') printf '%s\n' '[]' ;;
  "context inspect --format {{.Endpoints.docker.Host}}") printf '%s\n' 'unix:///var/run/docker.sock' ;;
  'info') exit 0 ;;
  'compose version') printf '%s\n' 'Docker Compose version fixture' ;;
  *) exit 1 ;;
esac
EOF
cat > "$fixtures/nft" <<'EOF'
#!/bin/sh
[ "$1" = -c ] && exit 0
exit 1
EOF
cat > "$fixtures/chown" <<'EOF'
#!/bin/sh
[ "$1" = root:root ] || exit 1
exit 0
EOF
cat > "$fixtures/awk" <<'EOF'
#!/bin/sh
for argument do last=$argument; done
case "$last" in
  */.env) printf '%s\n' eth0 ;;
  *) exec /usr/bin/awk "$@" ;;
esac
EOF
chmod +x "$fixtures"/*
HP_STATE_DIR="$temporary/attacker-state" HP_REPO_ROOT="$temporary/attacker-repo" HP_OS_RELEASE_PATH="$temporary/attacker-os-release" HP_BOOT_GUARD_DOCKER_REQUIRES_PATH="$temporary/attacker-requires-path" PATH="$fixtures:/usr/bin:/bin:/usr/sbin:/sbin"
export HP_STATE_DIR HP_REPO_ROOT HP_OS_RELEASE_PATH HP_BOOT_GUARD_DOCKER_REQUIRES_PATH PATH
if sh "$cli" apply >"$temporary/apply.out" 2>&1; then
  printf '%s\n' 'apply unexpectedly succeeded without boot guard support' >&2
  exit 1
fi
[ -d "$state_dir" ]
[ ! -e "$temporary/attacker-state" ]
[ ! -e "$temporary/attacker-requires-path" ]
grep -q 'state directory は root:root' "$temporary/apply.out"

cat > "$fixtures/id" <<'EOF'
#!/bin/sh
case "$1" in
  -u|-g) printf '%s\n' 1000 ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$fixtures/id"
rm -rf "$state_dir"
if PATH="$fixtures:/usr/bin:/bin:/usr/sbin:/sbin" sh "$cli" apply >"$temporary/non-root.out" 2>&1; then
  printf '%s\n' 'apply accepted a non-root identity' >&2
  exit 1
fi
[ ! -e "$state_dir/state.json" ]
grep -q 'root で実行してください' "$temporary/non-root.out"

# 非 root ケースだけの id fixture を root に戻し、以後の state 検査を到達可能にする。
cat > "$fixtures/id" <<'EOF'
#!/bin/sh
case "$1" in
  -u) printf '%s\n' 0 ;;
  -g) printf '%s\n' 0 ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$fixtures/id"

# state.sh が apply 中に呼ぶコマンドは、check の必須コマンド一覧にも含まれていなければならない。
required_line=$(grep -F 'for command in ' "$(dirname "$cli")/host-preparation/common.sh")
for tool in cat chmod chown cmp dirname getent ln mkdir mv rm rmdir sed stat sysctl tr; do
  case " $required_line " in
    *" $tool "*) ;;
    *) printf '必須コマンド一覧に %s がありません\n' "$tool" >&2; exit 1 ;;
  esac
done

# boot-guard apply が使う外部コマンドも check の必須一覧で確認する。
for tool in cat chmod chown cmp grep ip ln mkdir mv nft readlink rm sed stat systemctl; do
  case " $required_line " in
    *" $tool "*) ;;
    *) printf 'boot guard の必須コマンド一覧に %s がありません\n' "$tool" >&2; exit 1 ;;
  esac
done

# host reboot apply が使う外部コマンドも check の必須一覧に含める。
for tool in cat chmod chown cmp getent ln mkdir mv readlink rm rmdir stat systemctl; do
  case " $required_line " in
    *" $tool "*) ;;
    *) printf 'host reboot の必須コマンド一覧に %s がありません\n' "$tool" >&2; exit 1 ;;
  esac
done

# CLI の apply は不正な state パスを変更せず拒否する。
state_fixture="$fixtures/stat"
cat > "$state_fixture" <<'EOF'
#!/bin/sh
exec /usr/bin/stat "$@"
EOF
chmod +x "$state_fixture"
export PATH="$fixtures:/usr/bin:/bin:/usr/sbin:/sbin"

state_case="$temporary/state-symlink"
state_dir=$state_case
configure_paths
mkdir -m 0700 "$state_case"
target="$temporary/untouched.json"
printf '%s\n' 'unrelated content' > "$target"
ln -s "$target" "$state_case/state.json"
if sh "$cli" apply >"$temporary/state-symlink.out" 2>&1; then
  printf '%s\n' 'apply accepted a symlink state file' >&2
  exit 1
fi
[ "$(cat "$target")" = 'unrelated content' ]
grep -q 'state が通常ファイルではありません' "$temporary/state-symlink.out"

state_case="$temporary/state-fifo"
state_dir=$state_case
configure_paths
mkdir -m 0700 "$state_case"
mkfifo "$state_case/state.json"
if sh "$cli" apply >"$temporary/state-fifo.out" 2>&1; then
  printf '%s\n' 'apply accepted a non-regular state file' >&2
  exit 1
fi
grep -q 'state が通常ファイルではありません' "$temporary/state-fifo.out"

state_case="$temporary/state-dir-symlink-target"
state_dir="$temporary/state-dir-symlink"
configure_paths
mkdir -m 0700 "$state_case"
printf '%s\n' 'unrelated content' > "$state_case/state.json"
ln -s "$state_case" "$temporary/state-dir-symlink"
if sh "$cli" apply >"$temporary/state-dir-symlink.out" 2>&1; then
  printf '%s\n' 'apply accepted a symlink state directory' >&2
  exit 1
fi
[ "$(cat "$state_case/state.json")" = 'unrelated content' ]
grep -q 'state directory' "$temporary/state-dir-symlink.out"

state_dir="$temporary/state-dir-file"
configure_paths
printf '%s\n' 'unrelated content' > "$state_dir"
if sh "$cli" apply >"$temporary/state-dir-file.out" 2>&1; then
  printf '%s\n' 'apply accepted a non-directory state path' >&2
  exit 1
fi
[ "$(cat "$state_dir")" = 'unrelated content' ]
grep -q 'state directory' "$temporary/state-dir-file.out"

state_dir="$temporary/state-dir-mode"
configure_paths
mkdir -m 0755 "$state_dir"
if sh "$cli" apply >"$temporary/state-dir-mode.out" 2>&1; then
  printf '%s\n' 'apply accepted a state directory with an unexpected mode' >&2
  exit 1
fi
[ "$(/usr/bin/stat -c '%a' "$state_dir")" = 755 ]
grep -q 'state directory' "$temporary/state-dir-mode.out"

state_dir="$temporary/state-dir-owner"
configure_paths
mkdir -m 0700 "$state_dir"
if sh "$cli" apply >"$temporary/state-dir-owner.out" 2>&1; then
  printf '%s\n' 'apply accepted a state directory not owned by root' >&2
  exit 1
fi
[ "$(/usr/bin/stat -c '%u:%g' "$state_dir")" != '0:0' ]
grep -q 'state directory は root:root' "$temporary/state-dir-owner.out"

# root 所有で mode 0600 の有効 state は再適用で書き換えず保持する。
state_fixture="$fixtures/stat"
cat > "$state_fixture" <<'EOF'
#!/bin/sh
if [ "$1" = -c ] && [ "$2" = '%u:%g %a' ]; then
  case "$3" in
    "$STATE_DIR"|"$STATE_DIR"/*|*/sysctl.d/*)
      mode=$(/usr/bin/stat -c '%a' "$3") || exit 1
      printf '0:0 %s\n' "$mode"
      ;;
    *) exec /usr/bin/stat "$@" ;;
  esac
else
  exec /usr/bin/stat "$@"
fi
EOF
chmod +x "$state_fixture"
state_dir="$temporary/state-valid"
configure_paths
mkdir -m 0700 "$state_dir"
printf '%s\n' '{"version":1}' > "$state_dir/state.json"
chmod 0600 "$state_dir/state.json"
cp "$state_dir/state.json" "$temporary/state-valid.before"
if sh "$cli" apply >"$temporary/state-valid.out" 2>&1; then
  printf '%s\n' 'apply unexpectedly succeeded without boot guard runtime support' >&2
  exit 1
fi
grep -q '"sysctl":\[' "$state_dir/state.json"
if ! grep -Eq 'host-preparation:|boot guard|sysctl' "$temporary/state-valid.out"; then
  cat "$temporary/state-valid.out" >&2
  exit 1
fi

# 予測可能な一時名に symlink が置かれても、その参照先へ書き込まない。
state_dir="$temporary/state-temp-link"
configure_paths
mkdir -m 0700 "$state_dir"
target="$temporary/temp-link-target"
printf '%s\n' 'unrelated content' > "$target"
wrapper_dir="$temporary/sh-wrapper"
mkdir "$wrapper_dir"
cat > "$wrapper_dir/sh" <<'EOF'
#!/bin/sh
if [ "$1" = "$HP_CLI_PATH" ]; then
  printf '%s\n' "$$" > "$HP_TEST_PID_FILE"
  ln -s "$HP_TEMP_TARGET" "$STATE_DIR/.state.json.$$.1"
fi
exec /bin/sh "$@"
EOF
chmod +x "$wrapper_dir/sh"
HP_CLI_PATH="$cli"
HP_TEST_PID_FILE="$temporary/cli.pid"
HP_TEMP_TARGET="$target"
PATH="$wrapper_dir:$PATH"
STATE_DIR="$state_dir"
export STATE_DIR HP_CLI_PATH HP_TEST_PID_FILE HP_TEMP_TARGET PATH
if sh "$cli" apply >"$temporary/state-temp-link.out" 2>&1; then
  printf '%s\n' 'apply unexpectedly succeeded without boot guard support' >&2
  exit 1
fi
temp_pid=$(cat "$HP_TEST_PID_FILE")
[ -L "$state_dir/.state.json.$temp_pid.1" ]
[ "$(cat "$target")" = 'unrelated content' ]
grep -q 'boot guard' "$temporary/state-temp-link.out" || { cat "$temporary/state-temp-link.out" >&2; exit 1; }

# state.json が確認後・初回配置前に作られても、内容を上書きしない。
state_dir="$temporary/state-concurrent"
configure_paths
mkdir -m 0700 "$state_dir"
cat > "$fixtures/ln" <<'EOF'
#!/bin/sh
if [ "$2" = "$STATE_DIR/state.json" ]; then
  printf '%s\n' '{"version":1,"owned":["concurrent"]}' > "$2"
  chmod 0600 "$2"
fi
exec /usr/bin/ln "$@"
EOF
chmod +x "$fixtures/ln"
if sh "$cli" apply >"$temporary/state-concurrent.out" 2>&1; then
  printf '%s\n' 'apply unexpectedly succeeded without boot guard support' >&2
  exit 1
fi
grep -q '"concurrent"' "$state_dir/state.json"
cmp "$state_dir/state.json" <<'EOF'
{"version":1,"owned":["concurrent"]}
EOF
grep -Eq 'host-preparation:|boot guard|sysctl' "$temporary/state-concurrent.out"

