#!/bin/sh
# 責務: Docker 配布元・Engine・Compose の判定と同意付き導入・更新を行う
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

# 公式スクリプトを安全な一時ファイルに取得し、表示後の同意で実行する。
hp_docker_run_official() (
  hp_di_tmp=$(mktemp "${TMPDIR:-/tmp}/hp-docker.XXXXXX") || {
    printf '%s\n' 'Docker 導入スクリプト用一時ファイルを作成できません。' >&2
    return 1
  }
  trap 'rm -f "$hp_di_tmp"' EXIT HUP INT TERM
  hp_di_url=https://get.docker.com
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -fsSL "$hp_di_url" -o "$hp_di_tmp" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only -qO "$hp_di_tmp" "$hp_di_url" || return 1
  else
    printf '%s\n' 'curl と ca-certificates を apt で導入します。' >&2
    hp_docker_consent "${1:-0}" || return 1
    if ! apt-get update || ! apt-get install -y curl ca-certificates; then
      printf '%s\n' '失敗段階: curl と ca-certificates の導入。手動で apt の状態を確認してください。' >&2
      return 1
    fi
    curl --proto '=https' --tlsv1.2 -fsSL "$hp_di_url" -o "$hp_di_tmp" || return 1
  fi
  hp_di_hash=$(sha256sum "$hp_di_tmp" | awk '{print $1}') || return 1
  printf '取得元: %s\nSHA-256: %s\nDocker Engine と関連パッケージ（Compose plugin 含む）を OS のパッケージ管理で導入します。\n' "$hp_di_url" "$hp_di_hash" >&2
  hp_docker_consent "${1:-0}" || return 1
  sh "$hp_di_tmp" || {
    printf '%s\n' '失敗段階: 公式スクリプト実行。自動で元に戻しません。Docker 以外のホスト設定は変更していません。Docker とパッケージの状態を手動確認してください。' >&2
    return 1
  }
)

hp_docker_run_compose_apt() (
  hp_di_yes=${1:-0}
  hp_di_ce=$(hp_docker_package_status docker-ce 2>/dev/null || :)
  hp_di_os_id=${hp_docker_os_id:-${HP_DOCKER_OS_ID:-}}
  hp_di_os_version=${hp_docker_os_version:-${HP_DOCKER_OS_VERSION:-}}
  hp_di_repo_added=no
  hp_di_debian_repo=no
  if [ -n "$hp_di_ce" ]; then
    hp_di_package=docker-compose-plugin
  else
    case "$hp_di_os_id:$hp_di_os_version" in
      ubuntu:*) hp_di_package=docker-compose-v2 ;;
      debian:12)
      hp_di_package=docker-compose-plugin
      hp_di_repo_added=yes
      hp_di_debian_repo=yes
      hp_di_keyring=${HP_DOCKER_KEYRING:-/etc/apt/keyrings/docker.asc}
      hp_di_list=${HP_DOCKER_LIST:-/etc/apt/sources.list.d/docker.list}
      hp_di_sources=${hp_di_list%/*}/docker.sources
      hp_di_arch=$(dpkg --print-architecture 2>/dev/null) || {
        printf '%s\n' '失敗段階: Debian のアーキテクチャ判定。手動で Compose plugin を導入してください。' >&2
        return 1
      }
      case "$hp_di_arch" in ''|*[!a-zA-Z0-9_-]*) printf '%s\n' '失敗段階: Debian のアーキテクチャ判定。' >&2; return 1 ;; esac
      hp_di_definition="deb [arch=$hp_di_arch signed-by=$hp_di_keyring] https://download.docker.com/linux/debian bookworm stable"
      hp_di_tmp=$(mktemp "${TMPDIR:-/tmp}/hp-docker-key.XXXXXX") || return 1
      trap 'rm -f "$hp_di_tmp"' EXIT HUP INT TERM
      if command -v curl >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -fsSL https://download.docker.com/linux/debian/gpg -o "$hp_di_tmp" || {
          printf '%s\n' '失敗段階: Docker 公式 GPG key の取得。' >&2
          return 1
        }
      elif command -v wget >/dev/null 2>&1; then
        wget --https-only -qO "$hp_di_tmp" https://download.docker.com/linux/debian/gpg || return 1
      else
        printf '%s\n' 'Docker 公式 GPG key の取得に curl または wget が必要です。' >&2
        return 1
      fi
      if [ -e "$hp_di_list" ] || [ -L "$hp_di_list" ]; then
        if [ ! -f "$hp_di_list" ] || [ -L "$hp_di_list" ]; then
          printf '既存の Docker apt 定義 %s が通常ファイルではないため中止します。\n' "$hp_di_list" >&2
          return 1
        fi
        if [ "$(cat "$hp_di_list")" != "$hp_di_definition" ]; then
          printf '既存の Docker apt 定義 %s が異なるため上書きせず中止します。内容を手動で確認してください。\n' "$hp_di_list" >&2
          return 1
        fi
        hp_di_repo_added=no
      elif [ -e "$hp_di_sources" ]; then
        printf '既存の Docker apt 定義 %s はこの処理の形式と異なるため中止します。内容を手動で確認してください。\n' "$hp_di_sources" >&2
        return 1
      fi
      if [ -e "$hp_di_keyring" ] || [ -L "$hp_di_keyring" ]; then
        if [ ! -f "$hp_di_keyring" ] || [ -L "$hp_di_keyring" ]; then
          printf '既存の Docker apt key %s が通常ファイルではないため中止します。\n' "$hp_di_keyring" >&2
          return 1
        fi
        if ! cmp -s "$hp_di_tmp" "$hp_di_keyring"; then
          printf '既存の Docker apt key %s が異なるため上書きせず中止します。内容を手動で確認してください。\n' "$hp_di_keyring" >&2
          return 1
        fi
      fi
        ;;
      *)
        printf '%s\n' 'この Docker 配布元では Compose plugin を自動導入できません。配布元の公式手順で導入してください。' >&2
        return 1
        ;;
    esac
  fi
  if [ "$hp_di_repo_added" = yes ]; then
    printf '導入パッケージ: %s\nDocker 公式 Debian apt 配布元を追加します（%s）。\n' "$hp_di_package" "$hp_di_definition" >&2
  else
    printf '導入パッケージ: %s\napt 配布元の追加はありません。\n' "$hp_di_package" >&2
  fi
  hp_docker_consent "$hp_di_yes" || return 1
  if [ "$hp_di_debian_repo" = yes ]; then
    if [ ! -e "$hp_di_keyring" ] && [ ! -L "$hp_di_keyring" ]; then
      mkdir -p "${hp_di_keyring%/*}" || return 1
      hp_di_key_tmp=$(mktemp "${hp_di_keyring%/*}/.docker-key.XXXXXX") || return 1
      if ! cp "$hp_di_tmp" "$hp_di_key_tmp" || ! chmod 0644 "$hp_di_key_tmp"; then
        rm -f "$hp_di_key_tmp"
        return 1
      fi
      if ! ln "$hp_di_key_tmp" "$hp_di_keyring"; then
        rm -f "$hp_di_key_tmp"
        printf 'Docker apt key %s の配置先が競合したため中止します。\n' "$hp_di_keyring" >&2
        return 1
      fi
      rm -f "$hp_di_key_tmp"
    fi
    if [ ! -e "$hp_di_list" ] && [ ! -L "$hp_di_list" ]; then
      mkdir -p "${hp_di_list%/*}" || return 1
      hp_di_list_tmp=$(mktemp "${hp_di_list%/*}/.docker-list.XXXXXX") || return 1
      if ! printf '%s\n' "$hp_di_definition" >"$hp_di_list_tmp"; then
        rm -f "$hp_di_list_tmp"
        return 1
      fi
      if ! ln "$hp_di_list_tmp" "$hp_di_list"; then
        rm -f "$hp_di_list_tmp"
        printf 'Docker apt 定義 %s の配置先が競合したため中止します。\n' "$hp_di_list" >&2
        return 1
      fi
      rm -f "$hp_di_list_tmp"
    fi
    if ! DEBIAN_FRONTEND=noninteractive apt-get update; then
      printf '%s\n' '失敗段階: Docker 公式 apt 配布元の更新。自動で元に戻しません。apt と追加済み配布元を手動確認してください。' >&2
      return 1
    fi
    hp_di_simulation=$(DEBIAN_FRONTEND=noninteractive apt-get -s install --no-install-recommends docker-compose-plugin 2>&1) || {
      printf '%s\n' '失敗段階: Compose plugin の apt 模擬実行。自動で元に戻しません。' >&2
      return 1
    }
    if printf '%s\n' "$hp_di_simulation" | awk '
      /^(Remv|Purg)([[:space:]]|$)/ { bad=1 }
      /^Inst([[:space:]]|$)/ && $2 != "docker-compose-plugin" { bad=1 }
      /^Conf([[:space:]]|$)/ && $2 != "docker-compose-plugin" { bad=1 }
      END { exit !bad }
    '; then
      printf '%s\n' 'apt 模擬実行に Docker の置換・削除が含まれるため中止します。Docker package の状態を手動で確認してください。' >&2
      return 1
    fi
  fi
  if [ "$hp_di_repo_added" = yes ]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker-compose-plugin || {
      printf '%s\n' '失敗段階: Compose plugin の導入。自動で元に戻しません。Docker と apt の状態を手動確認してください。' >&2
      return 1
    }
  else
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$hp_di_package" || {
      printf '%s\n' '失敗段階: Compose plugin の導入。自動で元に戻しません。Docker と apt の状態を手動確認してください。' >&2
      return 1
    }
  fi
)

hp_docker_prepare() {
  hp_di_yes=${1:-0}
  hp_di_action=$(hp_docker_assess) || return 1
  case "$hp_di_action" in
    ready) return 0 ;;
    install)
      hp_di_message='Docker Engine と関連パッケージ（Compose plugin 含む）を導入します。'
      ;;
    upgrade)
      hp_di_version=$(hp_docker_engine_version)
      hp_di_message="現在の Docker Engine は ${hp_di_version} です。28 以上が必要です。Docker と稼働中コンテナが再起動します。公式スクリプトは既存 Docker を検出すると約20秒待機して続行します。"
      ;;
    compose)
      hp_docker_run_compose_apt "$hp_di_yes" || {
        printf '%s\n' 'Compose plugin の導入を完了できませんでした。自動で元に戻さず、失敗段階と Docker/apt の状態を手動確認してください。' >&2
        return 1
      }
      hp_di_action=$(hp_docker_assess) || hp_di_action=unsupported
      if [ "$hp_di_action" != ready ]; then
        printf '再検査に失敗しました（状態: %s）。失敗段階: Compose plugin 導入済み。自動で元に戻さず、rootful Engine・Compose plugin・Engine 28 以上を手動確認してください。\n' "$hp_di_action" >&2
        return 1
      fi
      hp_di_version=$(hp_docker_engine_version)
      printf 'Docker Engine %s と Compose plugin を確認しました。\n' "$hp_di_version" >&2
      return 0
      ;;
    unsupported) printf '%s\n' 'Docker の状態を自動解消できません。配布元と Engine を確認してください。' >&2; return 1 ;;
  esac
  printf '%s\n' "$hp_di_message" >&2
  hp_docker_run_official "$hp_di_yes" || {
    printf '%s\n' '失敗段階: Docker スクリプト取得または同意。自動で元に戻しません。Docker 以外のホスト設定は変更していません。Docker の導入状態とパッケージ管理を手動確認してください。' >&2
    return 1
  }
  hp_di_action=$(hp_docker_assess) || hp_di_action=unsupported
  if [ "$hp_di_action" != ready ]; then
    printf '再検査に失敗しました（状態: %s）。失敗段階: 取得・実行済み。Docker 以外のホスト設定は変更していません。自動で元に戻さず、rootful Engine・Compose plugin・Engine 28 以上を手動確認してください。\n' "$hp_di_action" >&2
    return 1
  fi
  hp_di_version=$(hp_docker_engine_version)
  printf 'Docker Engine %s と Compose plugin を確認しました。\n' "$hp_di_version" >&2
}

# apply の処理順への接続は後続タスクで行う。
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
