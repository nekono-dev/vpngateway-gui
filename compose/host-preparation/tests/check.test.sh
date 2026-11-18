#!/bin/sh
# 責務: host-preparation check の前提判定とパス固定を隔離実行で検証する
set -eu
source_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree="$temporary/tree"
mkdir -p "$tree/compose"
cp "$source_root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp -R "$source_root/compose/host-preparation" "$tree/compose/host-preparation"
cli="$tree/compose/host-preparation.sh"

run_case() (
  name=$1
  scenario=$2
  expected=${3:-}
  case_dir="$temporary/$name"
  bin="$case_dir/bin"
  repo="$case_dir/repo"
  mkdir -p "$bin" "$repo"
  printf '%s\n' 'ID=debian' 'VERSION_ID="12"' > "$case_dir/os-release"
  printf '%s\n' 'LAN_IFACE=eth0' > "$repo/.env"
  cp "$repo/.env" "$case_dir/env.before"
  cat > "$tree/compose/host-preparation/paths.sh" <<EOF
# 責務: テスト用の隔離パスを定義する
hp_os_release_path='$case_dir/os-release'
hp_repo_root='$repo'
hp_state_dir='$case_dir/state'
EOF

  for command in awk cat chmod chown cmp dirname getent grep head id ip ln mkdir mv nft readlink rm rmdir sed sort stat sysctl systemctl tr docker; do
    if [ "$scenario" != "missing:$command" ]; then
      command_path=$(command -v "$command" || :)
      [ -n "$command_path" ] || command_path=/usr/bin/true
      ln -s "$command_path" "$bin/$command"
    fi
  done
  /bin/rm -f "$bin/id" "$bin/ip" "$bin/docker" "$bin/nft" "$bin/getent"
  if [ "$scenario" != missing:id ]; then cat > "$bin/id" <<'EOF'
#!/bin/sh
case "$1" in -u|-g) printf '%s\n' "${FIX_UID:-0}" ;; *) exit 1 ;; esac
EOF
  fi
  if [ "$scenario" != missing:ip ]; then cat > "$bin/ip" <<'EOF'
#!/bin/sh
case "$*" in
  '-o route show default') printf '%s\n' 'default via 192.0.2.1 dev eth9' ;;
  'link show dev eth0') [ "${FIX_LINK:-yes}" = yes ] ;;
  'link show dev bad iface') exit 0 ;;
  *) exit 1 ;;
esac
EOF
  fi
  if [ "$scenario" != missing:docker ]; then cat > "$bin/docker" <<'EOF'
#!/bin/sh
case "$*" in
  'info --format {{json .SecurityOptions}}') printf '%s\n' "${FIX_DOCKER_SECURITY:-[]}" ;;
  "context inspect --format {{.Endpoints.docker.Host}}") printf '%s\n' "${FIX_DOCKER_CONTEXT_HOST:-unix:///var/run/docker.sock}" ;;
  'info') [ "${FIX_DOCKER_REACHABLE:-yes}" = yes ] ;;
  'compose version') [ "${FIX_COMPOSE:-yes}" = yes ] ;;
  *) exit 1 ;;
esac
EOF
  fi
  if [ "$scenario" != missing:nft ]; then cat > "$bin/nft" <<'EOF'
#!/bin/sh
[ "${FIX_NFT:-yes}" = yes ] && [ "$1" = -c ]
EOF
  fi
  if [ "$scenario" != missing:getent ]; then cat > "$bin/getent" <<'EOF'
#!/bin/sh
case "$1:$2" in
  passwd:10001)
    [ "${FIX_GETENT_ERROR:-no}" = yes ] && exit 3
    [ "${FIX_RESERVED_UID:-no}" = yes ] && { printf '%s\n' 'reserved:x:10001:10001:reserved:/nonexistent:/usr/sbin/nologin'; exit 0; }
    exit 2
    ;;
  group:10001)
    [ "${FIX_GETENT_ERROR:-no}" = yes ] && exit 3
    [ "${FIX_RESERVED_GID:-no}" = yes ] && { printf '%s\n' 'reserved:x:10001:'; exit 0; }
    exit 2
    ;;
  *) exit 2 ;;
esac
EOF
  fi
  /bin/chmod +x "$bin/id" "$bin/ip" "$bin/docker" "$bin/nft" "$bin/getent" 2>/dev/null || :

  case "$scenario" in
    unsupported-os) printf '%s\n' 'ID=alpine' 'VERSION_ID="3.20"' > "$case_dir/os-release" ;;
    non-root) FIX_UID=1000; export FIX_UID ;;
    rootless) FIX_DOCKER_SECURITY=rootless; export FIX_DOCKER_SECURITY ;;
    docker-down) FIX_DOCKER_REACHABLE=no; export FIX_DOCKER_REACHABLE ;;
    no-compose) FIX_COMPOSE=no; export FIX_COMPOSE ;;
    nft-fails) FIX_NFT=no; export FIX_NFT ;;
    unset-lan) : > "$repo/.env"; cp "$repo/.env" "$case_dir/env.before" ;;
    uid-conflict|uid-conflict-apply) FIX_RESERVED_UID=yes; export FIX_RESERVED_UID ;;
    gid-conflict|gid-conflict-apply) FIX_RESERVED_GID=yes; export FIX_RESERVED_GID ;;
    uid-lookup-error) FIX_GETENT_ERROR=yes; export FIX_GETENT_ERROR ;;
    malformed-lan) printf '%s\n' 'LAN_IFACE=bad iface' > "$repo/.env"; cp "$repo/.env" "$case_dir/env.before" ;;
    absent-lan) printf '%s\n' 'LAN_IFACE=missing0' > "$repo/.env"; cp "$repo/.env" "$case_dir/env.before" ;;
  esac
  export FIX_UID FIX_DOCKER_SECURITY FIX_DOCKER_REACHABLE FIX_COMPOSE FIX_NFT
  case "$scenario" in
    missing:*) expected="NG: 必要コマンドがありません: ${scenario#missing:}" ;;
  esac
  action=check
  case "$scenario" in
    uid-conflict-apply|gid-conflict-apply) action=apply ;;
    remote-tcp-apply) action=apply; DOCKER_HOST=tcp://192.0.2.44:2376; export DOCKER_HOST ;;
    remote-tcp) DOCKER_HOST=tcp://192.0.2.44:2376; export DOCKER_HOST ;;
    remote-ssh-context) unset DOCKER_HOST; FIX_DOCKER_CONTEXT_HOST=ssh://operator@192.0.2.44; export FIX_DOCKER_CONTEXT_HOST ;;
    local-unix) DOCKER_HOST=unix:///var/run/docker.sock; export DOCKER_HOST ;;
    unset-host-local-context) unset DOCKER_HOST; FIX_DOCKER_CONTEXT_HOST=unix:///var/run/docker.sock; export FIX_DOCKER_CONTEXT_HOST ;;
  esac
  set +e
  output=$(/usr/bin/env HP_REPO_ROOT="$case_dir/attacker-repo" HP_OS_RELEASE_PATH="$case_dir/attacker-os-release" HP_STATE_DIR="$case_dir/attacker-state" HP_BOOT_GUARD_DOCKER_REQUIRES_PATH="$case_dir/attacker-requires-path" PATH="$bin" /bin/sh "$cli" "$action" 2>&1)
  result=$?
  set -e
  case "$scenario" in
    remote-tcp|remote-tcp-apply|remote-ssh-context)
      expected='NG: Docker endpoint はローカルの unix:// socket である必要があります'
      ;;
  esac
  case "$scenario" in
    local-unix|unset-host-local-context)
      [ "$result" -eq 0 ] || { printf '%s\n' "$output" >&2; exit 1; }
      printf '%s\n' "$output" | /usr/bin/grep -Fq 'OK: rootful Docker Engine' || { printf '%s\n' "$output" >&2; exit 1; }
      ;;
    remote-tcp|remote-tcp-apply|remote-ssh-context)
      [ "$result" -ne 0 ] || { printf 'remote Docker endpoint unexpectedly passed: %s\n%s\n' "$scenario" "$output" >&2; exit 1; }
      printf '%s\n' "$output" | /usr/bin/grep -Fq "$expected" || { printf 'case missing verdict: %s\n%s\n' "$scenario" "$output" >&2; exit 1; }
      ;;
    satisfied)
    [ "$result" -eq 0 ] || { printf '%s\n' "$output" >&2; exit 1; }
    for line in 'OK: 対応 OS' 'OK: root' 'OK: rootful Docker Engine' 'OK: Docker Compose plugin' 'OK: nftables 構文検査' 'OK: LAN_IFACE=eth0'; do
      printf '%s\n' "$output" | /usr/bin/grep -Fq "$line" || { printf 'missing OK line: %s\n%s\n' "$line" "$output" >&2; exit 1; }
    done
      ;;
    uid-conflict|gid-conflict|uid-conflict-apply|gid-conflict-apply|uid-lookup-error)
      [ "$result" -ne 0 ] || { printf 'reserved ID unexpectedly passed: %s\n%s\n' "$scenario" "$output" >&2; exit 1; }
      case "$scenario" in
        gid-conflict|gid-conflict-apply) expected='NG: GID 10001' ;;
        uid-lookup-error) expected='NG: UID 10001 の使用状況を確認できません' ;;
        *) expected='NG: UID 10001' ;;
      esac
      printf '%s\n' "$output" | /usr/bin/grep -Fq "$expected" || { printf '%s\n' "$output" >&2; exit 1; }
      [ ! -e "$case_dir/state/state.json" ] || { printf 'reserved ID case wrote state: %s\n' "$scenario" >&2; exit 1; }
      ;;
    *)
    [ "$result" -ne 0 ] || { printf 'case unexpectedly passed: %s\n%s\n' "$name" "$output" >&2; exit 1; }
    printf '%s\n' "$output" | /usr/bin/grep -Fq "$expected" || { printf 'case missing verdict: %s\n%s\n' "$name" "$output" >&2; exit 1; }
      ;;
  esac
  if [ "$scenario" = unset-lan ]; then
    printf '%s\n' "$output" | /usr/bin/grep -Fq '既定ルートの候補: eth9' || { printf '%s\n' "$output" >&2; exit 1; }
  fi
  if [ "$scenario" = remote-tcp-apply ]; then
    [ ! -e "$case_dir/attacker-state" ] || { printf '%s\n' 'apply created state before rejecting the remote endpoint' >&2; exit 1; }
  fi
  [ ! -e "$case_dir/attacker-requires-path" ] || { printf '%s\n' 'check used an environment-provided Docker dependency path' >&2; exit 1; }
  cmp "$case_dir/env.before" "$repo/.env"
)

run_case unsupported-os unsupported-os 'NG: Debian 12+ または Ubuntu 22.04+ が必要です'
run_case non-root non-root 'NG: root で実行してください'
for command in awk cat chmod chown cmp dirname getent grep head id ip ln mkdir mv nft readlink rm rmdir sed sort stat sysctl systemctl tr docker; do
  run_case "missing-$command" "missing:$command"
done
run_case rootless rootless 'NG: rootless Docker はサポート対象外です'
run_case remote-tcp remote-tcp 'NG: Docker endpoint はローカルの unix:// socket である必要があります'
run_case remote-tcp-apply remote-tcp-apply 'NG: Docker endpoint はローカルの unix:// socket である必要があります'
run_case remote-ssh-context remote-ssh-context 'NG: Docker endpoint はローカルの unix:// socket である必要があります'
run_case local-unix local-unix
run_case unset-host-local-context unset-host-local-context
run_case docker-down docker-down 'NG: Docker Engine に接続できません'
run_case no-compose no-compose 'NG: Docker Compose plugin が必要です'
run_case nft-fails nft-fails 'NG: nft -c による構文検査ができません'
run_case unset-lan unset-lan 'NG: repository root の .env に LAN_IFACE を一つ設定してください'
run_case malformed-lan malformed-lan 'NG: LAN_IFACE に使用できない文字が含まれています'
run_case absent-lan absent-lan 'NG: LAN_IFACE がホストにありません: missing0'
run_case satisfied satisfied
run_case uid-conflict uid-conflict
run_case gid-conflict gid-conflict
run_case uid-conflict-apply uid-conflict-apply
run_case gid-conflict-apply gid-conflict-apply
run_case uid-lookup-error uid-lookup-error

# 本番 paths.sh は固定値を持ち、通常環境変数を参照しない。
grep -Fq 'hp_os_release_path=/etc/os-release' "$source_root/compose/host-preparation/paths.sh"
grep -Fq 'hp_state_dir=/var/lib/vpngwgui-host-preparation' "$source_root/compose/host-preparation/paths.sh"
grep -Fq 'hp_boot_guard_docker_requires_path=/etc/systemd/system/docker.service.requires/vpngwgui-boot-guard.service' "$source_root/compose/host-preparation/paths.sh"
grep -Fq 'script_dir/..' "$source_root/compose/host-preparation/paths.sh"
if grep -Eq 'HP_(OS_RELEASE_PATH|REPO_ROOT|STATE_DIR|BOOT_GUARD_UNIT_PATH|BOOT_GUARD_RULES_PATH|BOOT_GUARD_DOCKER_REQUIRES_PATH)' "$source_root/compose/host-preparation.sh" "$source_root/compose/host-preparation/common.sh" "$source_root/compose/host-preparation/state.sh" "$source_root/compose/host-preparation/boot-guard.sh" "$source_root/compose/host-preparation/status.sh" "$source_root/compose/host-preparation/remove.sh" "$source_root/compose/host-preparation/paths.sh"; then
  printf '%s\n' 'production code contains an environment path seam' >&2
  exit 1
fi
printf '%s\n' 'host-preparation check CLI cases passed'
