#!/bin/sh
# 責務: Docker 配布元・Engine・Compose の読み取り専用判定と同意入口を検証する
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
mkdir -p "$temporary/bin"
for command in awk cat chmod head mv rm sed; do ln -s "$(command -v "$command")" "$temporary/bin/$command"; done
export PATH="$temporary/bin"
export HP_DOCKER_OS_ID=debian HP_DOCKER_OS_VERSION=12
. "$root/compose/host-preparation/docker-install.sh"

cat > "$temporary/bin/dpkg-query" <<'STUB'
#!/bin/sh
case "$*" in
  *docker-ce*) [ "${FIX_CE:-no}" = yes ] && { printf 'installed 5:28.0.0-1\n'; exit 0; } ;;
  *docker.io*) [ "${FIX_IO:-no}" = yes ] && { printf 'installed 20.10.24-1\n'; exit 0; } ;;
esac
exit 1
STUB
cat > "$temporary/bin/docker" <<'STUB'
#!/bin/sh
case "$*" in
  'version --format {{.Server.Version}}') [ "${FIX_DAEMON:-up}" = up ] && printf '%s\n' "${FIX_ENGINE_VERSION:-28.0.0}" || exit 1 ;;
  'info --format {{json .SecurityOptions}}') [ "${FIX_DAEMON:-up}" = up ] || exit 1; printf '%s\n' "${FIX_SECURITY:-[]}" ;;
  'context inspect --format {{.Endpoints.docker.Host}}') printf '%s\n' "${FIX_ENDPOINT:-unix:///var/run/docker.sock}" ;;
  'compose version') [ "${FIX_COMPOSE:-yes}" = yes ] ;;
  *) exit 1 ;;
esac
STUB
cat > "$temporary/bin/dockerd" <<'STUB'
#!/bin/sh
printf '%s\n' "Docker version ${FIX_DOCKERD_VERSION:-28.0.0}, build fixture"
STUB
cat > "$temporary/bin/id" <<'STUB'
#!/bin/sh
[ "$1" = -u ] && { printf '%s\n' 0; exit 0; }
exit 1
STUB
chmod +x "$temporary/bin/dpkg-query" "$temporary/bin/docker" "$temporary/bin/dockerd" "$temporary/bin/id"

assert_action() {
  expected=$1
  actual=$(hp_docker_assess)
  [ "$actual" = "$expected" ] || { printf 'expected %s, got %s\n' "$expected" "$actual" >&2; exit 1; }
}

# 未導入、CE/OS 標準、併存、非対応 package、daemon 起動/停止と Engine 実効版。
mv "$temporary/bin/docker" "$temporary/docker.initial"
mv "$temporary/bin/dockerd" "$temporary/dockerd.initial"
assert_action install
mv "$temporary/docker.initial" "$temporary/bin/docker"
mv "$temporary/dockerd.initial" "$temporary/bin/dockerd"
FIX_CE=yes FIX_ENGINE_VERSION=27.5.0; export FIX_CE FIX_ENGINE_VERSION
assert_action upgrade
FIX_CE=no FIX_IO=yes; export FIX_CE FIX_IO
assert_action unsupported
FIX_ENGINE_VERSION=28.0.0; export FIX_ENGINE_VERSION
assert_action ready
FIX_CE=yes FIX_IO=yes; export FIX_CE FIX_IO
assert_action unsupported
FIX_CE=no FIX_IO=no; export FIX_CE FIX_IO
mv "$temporary/bin/docker" "$temporary/docker.hidden"
mv "$temporary/bin/dockerd" "$temporary/dockerd.hidden"
assert_action install
mv "$temporary/dockerd.hidden" "$temporary/bin/dockerd"
mv "$temporary/docker.hidden" "$temporary/bin/docker"
FIX_CE=no FIX_IO=no; export FIX_CE FIX_IO
assert_action unsupported

# rootless、remote endpoint、remote context、Engine 版判定不能通过时拒否する。
FIX_CE=yes FIX_IO=no FIX_SECURITY='rootless' FIX_ENGINE_VERSION=28.0.0; export FIX_CE FIX_IO FIX_SECURITY FIX_ENGINE_VERSION
assert_action unsupported
unset FIX_SECURITY
FIX_ENDPOINT=tcp://192.0.2.10:2376; export FIX_ENDPOINT
assert_action unsupported
FIX_ENDPOINT=unix:///run/user/1000/docker.sock; export FIX_ENDPOINT
assert_action unsupported
unset FIX_ENDPOINT
# DOCKER_HOST が明示された場合、context のローカル endpoint で上書き判定しない。
DOCKER_HOST=tcp://192.0.2.10:2376; export DOCKER_HOST
assert_action unsupported
DOCKER_HOST=unix:///var/run/docker.sock; export DOCKER_HOST
assert_action ready
unset DOCKER_HOST
DOCKER_HOST=ssh://operator@example; export DOCKER_HOST
assert_action unsupported
unset DOCKER_HOST
FIX_DAEMON=down; export FIX_DAEMON
FIX_DOCKERD_VERSION=27.5.0; export FIX_DOCKERD_VERSION
assert_action upgrade
FIX_DOCKERD_VERSION=28.0.0; export FIX_DOCKERD_VERSION
assert_action ready
unset FIX_DAEMON
FIX_ENGINE_VERSION=unknown; export FIX_ENGINE_VERSION
assert_action unsupported
FIX_ENGINE_VERSION=28.0.0; export FIX_ENGINE_VERSION

# 対応 Compose 欠落は候補、その他 OS の docker.io は非対応。
FIX_COMPOSE=no FIX_CE=yes FIX_IO=no; export FIX_COMPOSE FIX_CE FIX_IO
assert_action compose
FIX_CE=no FIX_IO=yes HP_DOCKER_OS_ID=ubuntu HP_DOCKER_OS_VERSION=24.04; export FIX_CE FIX_IO HP_DOCKER_OS_ID HP_DOCKER_OS_VERSION
assert_action compose
FIX_CE=no FIX_IO=yes HP_DOCKER_OS_ID=debian HP_DOCKER_OS_VERSION=12; export FIX_CE FIX_IO HP_DOCKER_OS_ID HP_DOCKER_OS_VERSION
assert_action compose
FIX_CE=no FIX_IO=yes HP_DOCKER_OS_ID=fedora; export FIX_CE FIX_IO HP_DOCKER_OS_ID
assert_action unsupported
HP_DOCKER_OS_ID=debian HP_DOCKER_OS_VERSION=11; export HP_DOCKER_OS_ID HP_DOCKER_OS_VERSION
assert_action unsupported

# 同意は指定 tty から読み、stdin の yes は同意にならない。
printf '%s\n' no > "$temporary/tty"
HP_DOCKER_TTY=$temporary/tty; export HP_DOCKER_TTY
if printf '%s\n' yes | hp_docker_consent 0 >/dev/null 2>&1; then exit 1; fi
hp_docker_consent 1
HP_DOCKER_TTY=$temporary/missing; export HP_DOCKER_TTY
if hp_docker_consent 0 >/dev/null 2>&1; then exit 1; fi

# 判定と同意の入口はファイル・state を作成しない。
[ ! -e "$temporary/state" ]
[ ! -e "$temporary/daemon.json" ]
printf '%s\n' 'host-preparation Docker assessment cases passed'
