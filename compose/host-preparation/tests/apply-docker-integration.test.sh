#!/bin/sh
# 責務: 実 CLI apply と Docker 導入・再検査の結合、および失敗時の無変更を確認する
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
tree=$temporary/tree
bin=$temporary/bin
host=$temporary/host
mkdir -p "$tree/compose/host-preparation" "$bin" "$host"
cp "$root/compose/host-preparation.sh" "$tree/compose/host-preparation.sh"
cp "$root"/compose/host-preparation/*.sh "$tree/compose/host-preparation/"
cat > "$tree/.env" <<'ENV'
LAN_IFACE=eth0
ENV
cat > "$tree/compose/host-preparation/paths.sh" <<'PATHS'
hp_os_release_path="$HP_TEST_OS_RELEASE"
hp_repo_root="$HP_TEST_REPO"
hp_state_dir="$HP_TEST_HOST/state"
hp_docker_daemon_config_path="$HP_TEST_HOST/docker/daemon.json"
hp_sysctl_config_path="$HP_TEST_HOST/sysctl/99-vpngwgui.conf"
hp_boot_guard_unit_path="$HP_TEST_HOST/systemd/vpngwgui-boot-guard.service"
hp_boot_guard_docker_requires_path="$HP_TEST_HOST/systemd/docker.service.requires/vpngwgui-boot-guard.service"
hp_boot_guard_rules_path="$HP_TEST_HOST/etc/vpngwgui/boot-guard.nft"
hp_host_ctl_dir="$HP_TEST_HOST/host-ctl"
hp_host_reboot_path_unit_path="$HP_TEST_HOST/systemd/vpngwgui-host-reboot.path"
hp_host_reboot_service_unit_path="$HP_TEST_HOST/systemd/vpngwgui-host-reboot.service"
hp_host_reboot_exec_path="$HP_TEST_HOST/libexec/vpngwgui-host-reboot"
hp_host_reboot_enable_link_path="$HP_TEST_HOST/systemd/multi-user.target.wants/vpngwgui-host-reboot.path"
hp_host_reboot_spool_dir="$HP_TEST_HOST/reboot-spool"
PATHS
cat > "$temporary/os-release" <<'OS'
ID=ubuntu
VERSION_ID="24.04"
OS

SYSTEM_SH=$(command -v sh)
SYSTEM_LN=$(command -v ln)
SYSTEM_SHA256SUM=$(command -v sha256sum)
SYSTEM_STAT=$(command -v stat)
SYSTEM_CP=$(command -v cp)
export SYSTEM_SH SYSTEM_LN SYSTEM_SHA256SUM SYSTEM_STAT SYSTEM_CP
for command in awk cat chmod cmp cp dirname find getent grep head ln mkdir mktemp mv readlink rm rmdir sed sleep sort touch tr; do
  ln -s "$(command -v "$command")" "$bin/$command"
done
cat > "$bin/id" <<'STUB'
#!/bin/sh
[ "$1" = -u ] && { printf '0\n'; exit 0; }
exit 1
STUB
cat > "$bin/ip" <<'STUB'
#!/bin/sh
[ "$1" = link ] && exit 0
[ "$1" = -o ] && { printf 'default via 192.0.2.1 dev eth0\n'; exit 0; }
exit 1
STUB
cat > "$bin/nft" <<'STUB'
#!/bin/sh
case "$*" in
  '-c -f -') cat >/dev/null; exit 0 ;;
  '-f '*) touch "$HP_TEST_HOST/nft-table"; exit 0 ;;
  *'list chain ip filter FORWARD'*) printf 'chain FORWARD { policy accept; }\n'; exit 0 ;;
  *'list table'*)
    [ -f "$HP_TEST_HOST/nft-table" ] || exit 1
    cat <<'TABLE'
table inet vpngwgui_guard {
 set healthy_lease4 {
  type ifname
  flags timeout
 }
 chain guard_forward {
  type filter hook forward priority filter - 1; policy accept;
  iifname "eth0" drop
 }
}
TABLE
    ;;
esac
exit 0
STUB
cat > "$bin/sysctl" <<'STUB'
#!/bin/sh
case "$1" in -n) printf '0\n' ;; -w) exit 0 ;; *) exit 0 ;; esac
STUB
cat > "$bin/systemctl" <<'STUB'
#!/bin/sh
case "$1" in
  is-enabled) printf 'enabled\n' ;;
  show) printf 'docker.service\n' ;;
  enable)
    unit=$2
    [ "$unit" != --now ] || unit=$3
    case "$unit" in
      vpngwgui-boot-guard.service)
        mkdir -p "$HP_TEST_HOST/systemd/docker.service.requires"
        ln -sf "$HP_TEST_HOST/systemd/vpngwgui-boot-guard.service" "$HP_TEST_HOST/systemd/docker.service.requires/vpngwgui-boot-guard.service"
        ;;
      vpngwgui-host-reboot.path)
        mkdir -p "$HP_TEST_HOST/systemd/multi-user.target.wants"
        ln -sf "$HP_TEST_HOST/systemd/vpngwgui-host-reboot.path" "$HP_TEST_HOST/systemd/multi-user.target.wants/vpngwgui-host-reboot.path"
        ;;
    esac
    ;;
esac
exit 0
STUB
cat > "$bin/stat" <<'STUB'
#!/bin/sh
if [ "$1" = -c ] && [ "$2" = '%u:%g %a' ]; then
  mode=$("$SYSTEM_STAT" -c '%a' "$3") || exit 1
  case "$3" in */host-ctl) printf '10001:10001 %s\n' "$mode" ;; *) printf '0:0 %s\n' "$mode" ;; esac
else
  exec "$SYSTEM_STAT" "$@"
fi
STUB
cat > "$bin/chown" <<'STUB'
#!/bin/sh
exit 0
STUB
cat > "$bin/dpkg-query" <<'STUB'
#!/bin/sh
[ "${HP_SCENARIO:-}" = ready ] || [ -f "$HP_TEST_INSTALL_MARKER" ] || exit 1
case "$*" in *docker-ce*) printf 'installed 5:28.0.0-1\n'; exit 0 ;; esac
exit 1
STUB
cat > "$bin/docker" <<'STUB'
#!/bin/sh
case "$*" in
  'version --format {{.Server.Version}}') [ "${HP_SCENARIO:-}" = ready ] || [ -f "$HP_TEST_INSTALL_MARKER" ] || exit 1; case "${HP_SCENARIO:-}" in verify-engine) printf '27.0.0\n' ;; *) printf '%s\n' "${HP_ENGINE_VERSION:-28.0.0}" ;; esac ;;
  'info --format {{json .SecurityOptions}}') [ "${HP_SCENARIO:-}" = ready ] || [ -f "$HP_TEST_INSTALL_MARKER" ] || exit 1; case "${HP_SCENARIO:-}" in verify-rootless) printf '["rootless"]\n' ;; *) printf '%s\n' "${HP_SECURITY:-[]}" ;; esac ;;
  'context inspect --format {{.Endpoints.docker.Host}}') printf 'unix:///var/run/docker.sock\n' ;;
  'compose version') [ "${HP_SCENARIO:-}" = ready ] || [ -f "$HP_TEST_INSTALL_MARKER" ] || exit 1; [ "${HP_SCENARIO:-}" != verify-compose ] ;;
  *) exit 0 ;;
esac
STUB
cat > "$bin/dockerd" <<'STUB'
#!/bin/sh
[ "${HP_SCENARIO:-}" = ready ] && printf 'Docker version 28.0.0, build fixture\n'
STUB
cat > "$bin/curl" <<'STUB'
#!/bin/sh
[ "${HP_SCENARIO:-}" = fetch-fail ] && exit 22
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then output=$2; shift 2; else shift; fi
done
printf '%s\n' 'fixture official installer' > "$output"
STUB
cat > "$bin/wget" <<'STUB'
#!/bin/sh
exit 1
STUB
cat > "$bin/sha256sum" <<'STUB'
#!/bin/sh
exec "$SYSTEM_SHA256SUM" "$@"
STUB
cat > "$bin/sh" <<'STUB'
#!/bin/sh
case "$1" in
  */hp-docker.*)
    [ "${HP_SCENARIO:-}" != install-fail ] || exit 9
    : > "$HP_TEST_INSTALL_MARKER"
    "$SYSTEM_CP" "$HP_TEST_DOCKER_STUB" "$HP_TEST_BIN/docker"
    "$SYSTEM_CP" "$HP_TEST_DOCKERD_STUB" "$HP_TEST_BIN/dockerd"
    exit 0
    ;;
esac
exec "$SYSTEM_SH" "$@"
STUB
cat > "$bin/apt-get" <<'STUB'
#!/bin/sh
exit 0
STUB
chmod +x "$bin"/id "$bin"/ip "$bin"/nft "$bin"/sysctl "$bin"/systemctl "$bin"/stat "$bin"/chown "$bin"/dpkg-query "$bin"/docker "$bin"/dockerd "$bin"/curl "$bin"/wget "$bin"/sha256sum "$bin"/sh "$bin"/apt-get
cp "$bin/docker" "$temporary/docker.stub"
cp "$bin/dockerd" "$temporary/dockerd.stub"

export PATH="$bin"
export HP_TEST_OS_RELEASE="$temporary/os-release" HP_TEST_REPO="$tree" HP_TEST_HOST="$host"
export HP_TEST_INSTALL_MARKER="$temporary/docker-installed" HP_TEST_BIN="$bin"
export HP_TEST_DOCKER_STUB="$temporary/docker.stub" HP_TEST_DOCKERD_STUB="$temporary/dockerd.stub"
export HP_DOCKER_TTY="$temporary/tty"
printf 'yes\n' > "$HP_DOCKER_TTY"

# 既存資材を置き、作成・削除・内容更新・リンク先変更を検出する。
mkdir -p "$host/state" "$host/docker" "$host/sysctl" "$host/systemd/docker.service.requires" "$host/systemd/multi-user.target.wants" "$host/etc/vpngwgui" "$host/host-ctl" "$host/reboot-spool" "$host/libexec"
printf '{"version":1}\n' > "$host/state/state.json"
chmod 700 "$host/state"
chmod 600 "$host/state/state.json"
printf '{"other":true}\n' > "$host/docker/daemon.json"
printf 'sentinel sysctl\n' > "$host/sysctl/99-vpngwgui.conf"
printf 'sentinel guard\n' > "$host/systemd/vpngwgui-boot-guard.service"
ln -s "$host/systemd/vpngwgui-boot-guard.service" "$host/systemd/docker.service.requires/vpngwgui-boot-guard.service"
printf 'sentinel rules\n' > "$host/etc/vpngwgui/boot-guard.nft"
printf 'sentinel helper\n' > "$host/libexec/vpngwgui-host-reboot"
printf 'sentinel path unit\n' > "$host/systemd/vpngwgui-host-reboot.path"
printf 'sentinel service unit\n' > "$host/systemd/vpngwgui-host-reboot.service"
ln -s "$host/systemd/vpngwgui-host-reboot.path" "$host/systemd/multi-user.target.wants/vpngwgui-host-reboot.path"
printf 'sentinel request\n' > "$host/host-ctl/reboot-request"
printf 'sentinel spool\n' > "$host/reboot-spool/request"

snapshot() {
  (
    cd "$host"
    find . -print | LC_ALL=C sort
    find . -type f -exec "$SYSTEM_SHA256SUM" {} \; | LC_ALL=C sort
    find . -type l -exec sh -c 'for path do printf "%s -> %s\n" "$path" "$(readlink "$path")"; done' sh {} + | LC_ALL=C sort
  )
}
baseline=$(snapshot)
printf '%s\n' "$baseline" > "$temporary/baseline"
run_apply_failure() {
  scenario=$1; shift
  rm -f "$bin/docker" "$bin/dockerd" "$HP_TEST_INSTALL_MARKER"
  HP_SCENARIO=$scenario "$@" sh "$tree/compose/host-preparation.sh" apply >"$temporary/output" 2>&1 && {
    cat "$temporary/output" >&2
    printf 'apply が成功しました: %s\n' "$scenario" >&2
    exit 1
  }
  after=$(snapshot)
  [ "$after" = "$baseline" ] || {
    printf '失敗時にホスト資材が変化しました: %s\n' "$scenario" >&2
    snapshot > "$temporary/after"
    diff -u "$temporary/baseline" "$temporary/after" >&2 || :
    exit 1
  }
}

# tty 不在、同意拒否、取得失敗、取得した公式スクリプトの失敗。
run_apply_failure tty-missing env -u HP_DOCKER_TTY
printf 'no\n' > "$HP_DOCKER_TTY"
run_apply_failure consent-rejected env
printf 'yes\n' > "$HP_DOCKER_TTY"
run_apply_failure fetch-fail env
run_apply_failure install-fail env

# 導入後の再検査失敗: Engine 28 未満、Compose 欠落、rootless。
run_apply_failure verify-engine env
run_apply_failure verify-compose env
run_apply_failure verify-rootless env

# Docker 準備済みなら tty と --yes なしで実 apply 全段階を完了する。
rm -rf "$host"
mkdir -p "$host/docker" "$host/sysctl" "$host/etc" "$host/systemd" "$host/libexec"
chmod 755 "$host/etc" "$host/systemd" "$host/libexec"
cp "$HP_TEST_DOCKER_STUB" "$bin/docker"
cp "$HP_TEST_DOCKERD_STUB" "$bin/dockerd"
chmod +x "$bin/docker" "$bin/dockerd"
touch "$HP_TEST_INSTALL_MARKER"
HP_SCENARIO=ready sh "$tree/compose/host-preparation.sh" apply >"$temporary/ready-output" 2>&1 || {
  cat "$temporary/ready-output" >&2
  printf '%s\n' '準備済み Docker の apply が失敗しました' >&2
  exit 1
}
[ -f "$host/state/state.json" ]
[ -f "$host/sysctl/99-vpngwgui.conf" ]
[ -f "$host/systemd/vpngwgui-boot-guard.service" ]
[ -L "$host/systemd/docker.service.requires/vpngwgui-boot-guard.service" ]
[ -f "$host/libexec/vpngwgui-host-reboot" ]
[ -f "$host/systemd/vpngwgui-host-reboot.path" ]
[ -f "$host/systemd/vpngwgui-host-reboot.service" ]
[ -f "$host/docker/daemon.json" ]
printf '%s\n' 'apply-docker-integration: OK'
