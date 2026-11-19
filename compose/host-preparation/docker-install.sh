#!/bin/sh
# 責務: Docker 配布元・Engine・Compose を読み取り専用で判定し、同意入口を提供する
# shellcheck disable=SC2154

hp_docker_package_status() {
  dpkg-query -W -f='${db:Status-Status} ${Version}\n' "$1" 2>/dev/null |
    awk '$1 == "installed" { print $2; found=1 } END { if (!found) exit 1 }'
}

hp_docker_major() {
  printf '%s\n' "$1" | sed -n 's/^\([0-9][0-9]*\)\..*/\1/p'
}

hp_docker_engine_version() {
  hp_di_version=
  if hp_di_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null) && [ -n "$hp_di_version" ]; then
    printf '%s\n' "$hp_di_version"
    return 0
  fi
  dockerd --version 2>/dev/null | sed -n 's/.* version \([0-9][0-9.]*\).*/\1/p' | head -n 1
}

hp_docker_endpoint_rootful() {
  command -v docker >/dev/null 2>&1 || return 1
  if [ "${DOCKER_HOST+x}" = x ]; then
    [ "$DOCKER_HOST" = unix:///var/run/docker.sock ] || return 1
    hp_di_endpoint=$DOCKER_HOST
  else
    hp_di_endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null) || return 1
  fi
  [ "$hp_di_endpoint" = unix:///var/run/docker.sock ] || return 1
  if hp_di_security=$(docker info --format '{{json .SecurityOptions}}' 2>/dev/null); then
    case "$hp_di_security" in *rootless*) return 1 ;; esac
    return 0
  fi
  # daemon 停止中は、ローカル実行の dockerd 版を確認する。
  [ "$(id -u)" -eq 0 ] && command -v dockerd >/dev/null 2>&1
}

# stdout は ready/install/upgrade/compose/unsupported の固定値だけを返す。
hp_docker_assess() {
  hp_docker_os_id=${hp_docker_os_id:-${HP_DOCKER_OS_ID:-}}
  hp_docker_os_version=${hp_docker_os_version:-${HP_DOCKER_OS_VERSION:-}}
  if ! command -v dpkg-query >/dev/null 2>&1; then
    printf '%s\n' 'dpkg-query がなく、Docker 配布元を判定できません。' >&2
    printf '%s\n' unsupported
    return 0
  fi
  hp_di_ce=$(hp_docker_package_status docker-ce 2>/dev/null || :)
  hp_di_io=$(hp_docker_package_status docker.io 2>/dev/null || :)
  if [ -n "$hp_di_ce" ] && [ -n "$hp_di_io" ]; then
    printf '%s\n' 'docker-ce と docker.io が併存しています。' >&2
    printf '%s\n' unsupported
    return 0
  fi
  if [ -z "$hp_di_ce$hp_di_io" ]; then
    if command -v docker >/dev/null 2>&1 || command -v dockerd >/dev/null 2>&1; then
      printf '%s\n' 'Docker 実行ファイルはありますが、dpkg 配布元を判定できません。' >&2
      printf '%s\n' unsupported
    else
      printf '%s\n' 'Docker は未導入です。' >&2
      printf '%s\n' install
    fi
    return 0
  fi
  if ! hp_docker_endpoint_rootful; then
    printf '%s\n' 'rootless Docker、リモート endpoint、または判定不能な Engine は対象外です。' >&2
    printf '%s\n' unsupported
    return 0
  fi
  hp_di_version=$(hp_docker_engine_version)
  hp_di_major=$(hp_docker_major "$hp_di_version")
  if [ -z "$hp_di_major" ]; then
    printf '%s\n' 'Docker Engine の実効版を判定できません。' >&2
    printf '%s\n' unsupported
    return 0
  fi
  if [ "$hp_di_major" -lt 28 ]; then
    if [ -n "$hp_di_ce" ]; then
      printf 'docker-ce の実効版は %s です（28 以上が必要です）。apply の更新候補です。\n' "$hp_di_version" >&2
      printf '%s\n' upgrade
    else
      printf 'OS 標準 docker.io の実効版は %s です（28 未満は自動更新できません）。\n' "$hp_di_version" >&2
      printf '%s\n' unsupported
    fi
    return 0
  fi
  if ! docker compose version >/dev/null 2>&1; then
    if [ -n "$hp_di_ce" ] || [ "$hp_docker_os_id" = ubuntu ] ||
      { [ "$hp_docker_os_id" = debian ] && [ "$hp_docker_os_version" = 12 ]; }; then
      printf '%s\n' '対応配布元の Compose plugin がありません。apply の導入候補です。' >&2
      printf '%s\n' compose
    else
      printf '%s\n' 'この配布元では Compose plugin の自動導入対象外です。' >&2
      printf '%s\n' unsupported
    fi
    return 0
  fi
  printf 'Docker Engine %s と Compose plugin を確認しました。\n' "$hp_di_version" >&2
  printf '%s\n' ready
}

hp_docker_consent() {
  hp_di_yes=${1:-0}
  [ "$hp_di_yes" -eq 1 ] && return 0
  hp_di_tty=${HP_DOCKER_TTY:-/dev/tty}
  if [ ! -r "$hp_di_tty" ] || [ ! -w "$hp_di_tty" ]; then
    printf '%s\n' '対話端末がありません。変更前に終了します。--yes を指定してください。' >&2
    return 1
  fi
  printf '%s' '続行しますか [y/N]: ' >"$hp_di_tty"
  IFS= read -r hp_di_answer <"$hp_di_tty" || return 1
  case "$hp_di_answer" in
    y|Y|yes|YES) return 0 ;;
    *) printf '%s\n' '同意が得られなかったため中止しました。' >&2; return 1 ;;
  esac
}

# 将来の導入実装が差し替える入口。現段階ではホストを変更しない。
hp_docker_prepare_gate() {
  hp_di_yes=${1:-0}
  hp_di_action=$(hp_docker_assess) || return 1
  case "$hp_di_action" in
    ready) return 0 ;;
    install) printf '%s\n' '必要な対処: Docker Engine と Compose plugin を導入します。' >&2 ;;
    upgrade) printf '%s\n' '必要な対処: Docker 公式版を 28 以上へ更新します。' >&2 ;;
    compose) printf '%s\n' '必要な対処: 対応配布元から Compose plugin を導入します。' >&2 ;;
    unsupported) printf '%s\n' 'Docker の状態を自動解消できません。配布元と Engine を確認してください。' >&2; return 1 ;;
  esac
  hp_docker_consent "$hp_di_yes" || return 1
  printf '%s\n' 'Docker が利用可能になっていないため apply を中止しました。Docker 以外のホスト設定は変更していません。' >&2
  return 1
}
