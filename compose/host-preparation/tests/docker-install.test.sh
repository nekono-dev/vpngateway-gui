#!/bin/sh
# 責務: Docker 配布元・Engine・Compose の読み取り専用判定と同意入口を検証する
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
mkdir -p "$temporary/bin"
SYSTEM_LN=$(command -v ln)
for command in awk cat chmod head mv rm sed mktemp wc grep find touch mkdir cmp cp dirname ln; do ln -s "$(command -v "$command")" "$temporary/bin/$command"; done
export SYSTEM_LN
export PATH="$temporary/bin"
export HP_DOCKER_OS_ID=debian HP_DOCKER_OS_VERSION=12
. "$root/compose/host-preparation/docker-install.sh"

cat > "$temporary/bin/dpkg-query" <<'STUB'
#!/bin/sh
case "$*" in
  *docker-ce*) { [ "${FIX_CE:-no}" = yes ] || [ -e "$FIX_INSTALLED" ]; } && { printf 'installed 5:28.0.0-1\n'; exit 0; } ;;
  *docker.io*) [ "${FIX_IO:-no}" = yes ] && { printf 'installed 20.10.24-1\n'; exit 0; } ;;
esac
exit 1
STUB
cat > "$temporary/bin/docker" <<'STUB'
#!/bin/sh
case "$*" in
  'version --format {{.Server.Version}}') [ "${FIX_DAEMON:-up}" = up ] && { if [ -e "$FIX_INSTALLED" ]; then printf '28.0.0\n'; else printf '%s\n' "${FIX_ENGINE_VERSION:-28.0.0}"; fi; } || exit 1 ;;
  'info --format {{json .SecurityOptions}}') [ "${FIX_DAEMON:-up}" = up ] || exit 1; printf '%s\n' "${FIX_SECURITY:-[]}" ;;
  'context inspect --format {{.Endpoints.docker.Host}}') printf '%s\n' "${FIX_ENDPOINT:-unix:///var/run/docker.sock}" ;;
  'compose version') [ "${FIX_COMPOSE:-yes}" = yes ] || { [ -n "${FIX_COMPOSE_MARKER:-}" ] && [ -e "$FIX_COMPOSE_MARKER" ]; } ;;
  *) exit 1 ;;
esac
STUB
cat > "$temporary/bin/dockerd" <<'STUB'
#!/bin/sh
printf '%s\n' "Docker version ${FIX_DOCKERD_VERSION:-28.0.0}, build fixture"
STUB
cat > "$temporary/bin/dpkg" <<'STUB'
#!/bin/sh
[ "$1" = --print-architecture ] && { printf '%s\n' "${FIX_DOCKER_ARCH:-amd64}"; exit 0; }
exit 1
STUB
cat > "$temporary/bin/id" <<'STUB'
#!/bin/sh
[ "$1" = -u ] && { printf '%s\n' 0; exit 0; }
exit 1
STUB
chmod +x "$temporary/bin/dpkg-query" "$temporary/bin/dpkg" "$temporary/bin/docker" "$temporary/bin/dockerd" "$temporary/bin/id"

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
# 導入フローは取得方法・同意・実行・再検査をスタブで確認する。
mv "$temporary/bin/docker" "$temporary/docker.for-install"
mv "$temporary/bin/dockerd" "$temporary/dockerd.for-install"
cat > "$temporary/bin/curl" <<'STUB'
#!/bin/sh
[ "${FIX_FETCH:-curl}" = curl ] || exit 1
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then output=$2; shift 2
  elif [ "${1#http}" != "$1" ]; then FIX_CURL_URL=$1; shift
  else shift; fi
done
case "${FIX_CURL_URL:-}" in
  *download.docker.com/linux/debian/gpg) printf '%s\n' 'fixture gpg key' > "$output" ;;
  *) printf '%s\n' 'fixture installer' > "$output" ;;
esac
STUB
cat > "$temporary/bin/wget" <<'STUB'
#!/bin/sh
[ "${FIX_FETCH:-curl}" = wget ] || exit 1
while [ "$#" -gt 0 ]; do
  if [ "$1" = -qO ]; then output=$2; shift 2; else shift; fi
done
printf '%s\n' 'fixture installer' > "$output"
STUB
cat > "$temporary/bin/sha256sum" <<'STUB'
#!/bin/sh
printf '%s  %s\n' 'abc123' "$1"
STUB
cat > "$temporary/bin/apt-get" <<'STUB'
#!/bin/sh
printf 'apt %s\n' "$*" >> "$FIX_LOG"
if [ "$1" = -s ]; then
  [ -z "${FIX_SIM_LINE:-}" ] || printf '%s\n' "$FIX_SIM_LINE"
fi
if [ "$1" = install ]; then
  [ -e "$FIX_CURL_HIDDEN" ] && mv "$FIX_CURL_HIDDEN" "$FIX_CURL_PATH"
  [ -z "${FIX_COMPOSE_MARKER:-}" ] || touch "$FIX_COMPOSE_MARKER"
fi
STUB
cat > "$temporary/bin/sh" <<'STUB'
#!/bin/sh
[ "${FIX_SH_FAIL:-no}" = no ] || exit 9
touch "$FIX_INSTALLED"
if [ -e "$FIX_DOCKER_HIDDEN" ]; then mv "$FIX_DOCKER_HIDDEN" "$FIX_DOCKER_PATH"; fi
if [ -e "$FIX_DOCKERD_HIDDEN" ]; then mv "$FIX_DOCKERD_HIDDEN" "$FIX_DOCKERD_PATH"; fi
printf 'run %s\n' "$2" >> "$FIX_LOG"
STUB
rm -f "$temporary/bin/ln"
cat > "$temporary/bin/ln" <<'STUB'
#!/bin/sh
destination=$2
if [ "${FIX_LINK_RACE:-}" = "$destination" ] && [ ! -e "$destination" ] && [ ! -L "$destination" ]; then
  "$SYSTEM_LN" -s "$FIX_RACE_TARGET" "$destination" || exit 1
fi
exec "$SYSTEM_LN" "$@"
STUB
chmod +x "$temporary/bin/curl" "$temporary/bin/wget" "$temporary/bin/sha256sum" "$temporary/bin/apt-get" "$temporary/bin/sh" "$temporary/bin/ln"
FIX_LOG=$temporary/log HP_DOCKER_TTY=$temporary/yes FIX_CURL_HIDDEN=$temporary/curl.hidden FIX_CURL_PATH=$temporary/bin/curl FIX_INSTALLED=$temporary/installed FIX_DOCKER_HIDDEN=$temporary/docker.for-install FIX_DOCKER_PATH=$temporary/bin/docker FIX_DOCKERD_HIDDEN=$temporary/dockerd.for-install FIX_DOCKERD_PATH=$temporary/bin/dockerd; export FIX_LOG HP_DOCKER_TTY FIX_CURL_HIDDEN FIX_CURL_PATH FIX_INSTALLED FIX_DOCKER_HIDDEN FIX_DOCKER_PATH FIX_DOCKERD_HIDDEN FIX_DOCKERD_PATH
printf 'yes\n' > "$temporary/yes"
FIX_CE=no FIX_IO=no FIX_FETCH=curl; export FIX_CE FIX_IO FIX_FETCH
FIX_COMPOSE=yes; export FIX_COMPOSE
HP_DOCKER_OS_ID=debian HP_DOCKER_OS_VERSION=12; export HP_DOCKER_OS_ID HP_DOCKER_OS_VERSION
hide_fixture_docker() {
  [ ! -e "$temporary/bin/docker" ] || mv "$temporary/bin/docker" "$temporary/docker.for-install"
  [ ! -e "$temporary/bin/dockerd" ] || mv "$temporary/bin/dockerd" "$temporary/dockerd.for-install"
}
hp_docker_prepare 1
rm -f "$FIX_INSTALLED"
[ "$(wc -l < "$FIX_LOG")" -eq 1 ]
if find "$temporary" -name 'hp-docker.*' | grep .; then exit 1; fi
FIX_FETCH=wget; export FIX_FETCH
hide_fixture_docker
mv "$temporary/bin/curl" "$temporary/curl.hidden"
hp_docker_prepare 1
rm -f "$FIX_INSTALLED"
hide_fixture_docker
[ ! -e "$temporary/curl.hidden" ] || mv "$temporary/curl.hidden" "$temporary/bin/curl"
mv "$temporary/bin/curl" "$temporary/curl.hidden"
mv "$temporary/bin/wget" "$temporary/wget.hidden"
FIX_FETCH=curl; export FIX_FETCH
hp_docker_prepare 1
rm -f "$FIX_INSTALLED"
hide_fixture_docker
grep -q 'apt update' "$FIX_LOG"
[ ! -e "$temporary/curl.hidden" ] || mv "$temporary/curl.hidden" "$temporary/bin/curl"
mv "$temporary/wget.hidden" "$temporary/bin/wget"
hide_fixture_docker
HP_DOCKER_TTY=$temporary/no-tty; export HP_DOCKER_TTY
if hp_docker_prepare 0 </dev/null >/dev/null 2>&1; then exit 1; fi
printf 'no\n' > "$temporary/yes"
hide_fixture_docker
HP_DOCKER_TTY=$temporary/yes; export HP_DOCKER_TTY
if hp_docker_prepare 0 >/dev/null 2>&1; then exit 1; fi
printf 'yes\n' > "$temporary/yes"
FIX_FETCH=fail; export FIX_FETCH
hide_fixture_docker
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
FIX_FETCH=curl FIX_SH_FAIL=yes; export FIX_FETCH FIX_SH_FAIL
hide_fixture_docker
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
FIX_SH_FAIL=no FIX_CE=yes FIX_ENGINE_VERSION=27.5.0; export FIX_SH_FAIL FIX_CE FIX_ENGINE_VERSION
mv "$temporary/docker.for-install" "$temporary/bin/docker"
mv "$temporary/dockerd.for-install" "$temporary/bin/dockerd"
hp_docker_prepare 1
FIX_ENGINE_VERSION=28.0.0; export FIX_ENGINE_VERSION
before=$(wc -l < "$FIX_LOG")
hp_docker_prepare 1
[ "$(wc -l < "$FIX_LOG")" -eq "$before" ]
FIX_CE=no FIX_IO=no FIX_FETCH=curl FIX_COMPOSE=no; export FIX_CE FIX_IO FIX_FETCH FIX_COMPOSE
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi

# Compose 導入: Docker 公式版と Ubuntu docker.io はそれぞれのパッケージを同意後に導入する。
rm -f "$FIX_INSTALLED"
FIX_CE=yes FIX_IO=no FIX_COMPOSE=no FIX_COMPOSE_MARKER=$temporary/compose-installed HP_DOCKER_OS_ID=ubuntu HP_DOCKER_OS_VERSION=24.04; export FIX_CE FIX_IO FIX_COMPOSE FIX_COMPOSE_MARKER HP_DOCKER_OS_ID HP_DOCKER_OS_VERSION
rm -f "$FIX_COMPOSE_MARKER"
hp_docker_prepare 1
grep -q 'apt-get' "$FIX_LOG" || grep -q 'apt install -y docker-compose-plugin' "$FIX_LOG"
grep -q 'docker-compose-plugin' "$FIX_LOG"
rm -f "$FIX_COMPOSE_MARKER"
before=$(wc -l < "$FIX_LOG")
FIX_CE=no FIX_IO=yes HP_DOCKER_OS_ID=ubuntu; export FIX_CE FIX_IO HP_DOCKER_OS_ID
hp_docker_prepare 1
grep -q 'docker-compose-v2' "$FIX_LOG"

# Debian 12 は公式 apt repository を追加し、置換のない模擬実行後だけ導入する。
FIX_CE=no FIX_IO=yes HP_DOCKER_OS_ID=debian HP_DOCKER_OS_VERSION=12; export FIX_CE FIX_IO HP_DOCKER_OS_ID HP_DOCKER_OS_VERSION
FIX_DOCKER_KEYRING=$temporary/etc/apt/keyrings/docker.asc FIX_DOCKER_LIST=$temporary/etc/apt/sources.list.d/docker.list FIX_DOCKER_ARCH=amd64; export FIX_DOCKER_KEYRING FIX_DOCKER_LIST FIX_DOCKER_ARCH
HP_DOCKER_KEYRING=$FIX_DOCKER_KEYRING HP_DOCKER_LIST=$FIX_DOCKER_LIST; export HP_DOCKER_KEYRING HP_DOCKER_LIST
mkdir -p "$(dirname "$FIX_DOCKER_KEYRING")" "$(dirname "$FIX_DOCKER_LIST")"
FIX_CURL_URL=; export FIX_CURL_URL
FIX_COMPOSE_MARKER=$temporary/compose-installed; export FIX_COMPOSE_MARKER
rm -f "$FIX_COMPOSE_MARKER"
hp_docker_prepare 1
grep -q 'apt -s install --no-install-recommends docker-compose-plugin' "$FIX_LOG"
grep -q 'deb \[arch=amd64 signed-by=' "$FIX_DOCKER_LIST"
grep -q 'download.docker.com/linux/debian bookworm stable' "$FIX_DOCKER_LIST"
grep -q 'apt install -y --no-install-recommends docker-compose-plugin' "$FIX_LOG"

# Debian の同意拒否・端末なしは apt とファイルを変更しない。
rm -f "$FIX_COMPOSE_MARKER" "$FIX_DOCKER_LIST" "$FIX_DOCKER_KEYRING"
before=$(wc -l < "$FIX_LOG")
HP_DOCKER_TTY=$temporary/no-tty; export HP_DOCKER_TTY
if hp_docker_prepare 0 </dev/null >/dev/null 2>&1; then exit 1; fi
[ "$(wc -l < "$FIX_LOG")" -eq "$before" ]
[ ! -e "$FIX_DOCKER_LIST" ] && [ ! -e "$FIX_DOCKER_KEYRING" ]
HP_DOCKER_TTY=$temporary/yes; export HP_DOCKER_TTY
printf 'no\n' > "$temporary/yes"
if hp_docker_prepare 0 >/dev/null 2>&1; then exit 1; fi
[ "$(wc -l < "$FIX_LOG")" -eq "$before" ]
[ ! -e "$FIX_DOCKER_LIST" ] && [ ! -e "$FIX_DOCKER_KEYRING" ]
printf 'yes\n' > "$temporary/yes"

# apt の危険な計画行はすべて install 前に拒否する。
: > "$FIX_LOG"
for line in \
  'Inst docker.io [20.10]' 'Remv docker.io [20.10]' \
  'Inst docker-ce [5:28.0]' 'Remv docker-ce [5:28.0]' \
  'Inst docker-ce-cli [5:28.0]' 'Remv docker-ce-cli [5:28.0]' \
  'Inst containerd [1.6]' 'Remv containerd [1.6]' \
  'Inst containerd.io [1.6]' 'Remv containerd.io [1.6]' \
  'Inst runc [1.1]' 'Remv runc [1.1]' \
  'Purg unrelated [1]' 'Inst unrelated [1]' 'Conf unrelated [1]'; do
  rm -f "$FIX_COMPOSE_MARKER" "$FIX_DOCKER_LIST" "$FIX_DOCKER_KEYRING"
  before=$(wc -l < "$FIX_LOG")
  FIX_SIM_LINE=$line; export FIX_SIM_LINE
  if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
  [ "$(wc -l < "$FIX_LOG")" -eq $((before + 2)) ]
  if grep -q '^apt install -y --no-install-recommends docker-compose-plugin$' "$FIX_LOG"; then exit 1; fi
  [ ! -e "$FIX_COMPOSE_MARKER" ]
done
FIX_SIM_LINE='Inst docker-compose-plugin [2.20]'; export FIX_SIM_LINE
rm -f "$FIX_COMPOSE_MARKER" "$FIX_DOCKER_LIST" "$FIX_DOCKER_KEYRING"
hp_docker_prepare 1
grep -q '^apt install -y --no-install-recommends docker-compose-plugin$' "$FIX_LOG"
FIX_SIM_LINE=; export FIX_SIM_LINE

# 配置確認時の既存シンボリックリンクと、同意後の排他的配置競合を拒否する。
FIX_COMPOSE=no; export FIX_COMPOSE
rm -f "$FIX_DOCKER_LIST" "$FIX_DOCKER_KEYRING"
rm -f "$FIX_COMPOSE_MARKER"
ln -s "$temporary/target" "$FIX_DOCKER_KEYRING"
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
rm -f "$FIX_DOCKER_KEYRING"
ln -s "$temporary/target" "$FIX_DOCKER_LIST"
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
rm -f "$FIX_DOCKER_LIST"
for target in "$FIX_DOCKER_KEYRING" "$FIX_DOCKER_LIST"; do
  rm -f "$FIX_DOCKER_LIST" "$FIX_DOCKER_KEYRING" "$FIX_COMPOSE_MARKER"
  FIX_LINK_RACE=$target FIX_RACE_TARGET=$temporary/target; export FIX_LINK_RACE FIX_RACE_TARGET
  if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
  [ -L "$target" ]
  [ ! -e "$FIX_COMPOSE_MARKER" ]
done
FIX_LINK_RACE=; export FIX_LINK_RACE
rm -f "$FIX_DOCKER_LIST" "$FIX_DOCKER_KEYRING"
FIX_SIM_LINE=; export FIX_SIM_LINE

# 異なる既存定義、未対応 OS は変更前に中止する。
before=$(wc -l < "$FIX_LOG")
printf '%s\n' 'foreign repository' > "$FIX_DOCKER_LIST"
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
[ "$(cat "$FIX_DOCKER_LIST")" = 'foreign repository' ]
rm -f "$FIX_DOCKER_LIST"
FIX_CE=no FIX_IO=yes HP_DOCKER_OS_ID=arch HP_DOCKER_OS_VERSION=; export FIX_CE FIX_IO HP_DOCKER_OS_ID HP_DOCKER_OS_VERSION
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
# apt が成功しても Compose の再検査に失敗すれば非0終了する。
FIX_COMPOSE_MARKER='' FIX_COMPOSE=no HP_DOCKER_TTY=$temporary/yes; export FIX_COMPOSE_MARKER FIX_COMPOSE HP_DOCKER_TTY
if hp_docker_prepare 1 >/dev/null 2>&1; then exit 1; fi
printf '%s\n' 'host-preparation Docker assessment and install cases passed'
