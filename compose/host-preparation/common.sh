#!/bin/sh
# 責務: 対応 OS、実行権限、コマンド、Docker、nft、LAN interface の前提を検査する
# shellcheck disable=SC2154

hp_error() {
  printf 'host-preparation: %s\n' "$*" >&2
  exit 1
}

hp_os_supported() {
  [ -r "$hp_os_release_path" ] || return 1
  os_id=
  os_version=
  while IFS='=' read -r key value; do
    case "$key" in
      ID) os_id=$(printf '%s' "$value" | tr -d '"') ;;
      VERSION_ID) os_version=$(printf '%s' "$value" | tr -d '"') ;;
    esac
  done < "$hp_os_release_path"
  case "$os_id:$os_version" in
    debian:*) [ "$(printf '%s\n' "$os_version" 12 | sort -V | head -n 1)" = 12 ] ;;
    ubuntu:*) [ "$(printf '%s\n' "$os_version" 22.04 | sort -V | head -n 1)" = 22.04 ] ;;
    *) return 1 ;;
  esac
}

hp_read_lan_iface() {
  env_file=$1/.env
  [ -f "$env_file" ] || return 1
  awk '
    /^[[:space:]]*LAN_IFACE[[:space:]]*=/ {
      sub(/^[^=]*=/, "")
      sub(/^[[:space:]]*/, "")
      sub(/[[:space:]]*$/, "")
      if ($0 ~ /^".*"$/ || $0 ~ /^\047.*\047$/) { sub(/^./, ""); sub(/.$/, "") }
      value = $0
      count++
    }
    END { if (count == 1) print value; else exit 1 }
  ' "$env_file"
}

hp_default_route_candidate() {
  candidate=$(ip -o route show default 2>/dev/null | awk 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }')
  if [ -n "$candidate" ]; then
    printf 'host-preparation: LAN_IFACE が未設定です。既定ルートの候補: %s（.env は変更していません）\n' "$candidate" >&2
  fi
}

hp_check_prerequisites() {
  failed=0
  if hp_os_supported; then printf '%s\n' 'OK: 対応 OS'; else printf '%s\n' 'NG: Debian 12+ または Ubuntu 22.04+ が必要です' >&2; failed=1; fi
  if [ "$(id -u)" -eq 0 ]; then printf '%s\n' 'OK: root'; else printf '%s\n' 'NG: root で実行してください' >&2; failed=1; fi
  for command in awk chmod chown dirname grep head id ip ln mkdir mv nft rm sort stat sysctl systemctl tr docker; do
    if command -v "$command" >/dev/null 2>&1; then :; else printf 'NG: 必要コマンドがありません: %s\n' "$command" >&2; failed=1; fi
  done
  if command -v docker >/dev/null 2>&1; then
    # Docker Engine info に接続先の local/remote を確実に示す属性がないため、CLI の endpoint を判定する。
    if [ "${DOCKER_HOST+x}" = x ]; then
      docker_endpoint=$DOCKER_HOST
    elif docker_endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null); then
      :
    else
      docker_endpoint=
    fi
    case "$docker_endpoint" in
      unix:///*)
        if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -qi rootless; then
          printf '%s\n' 'NG: rootless Docker はサポート対象外です' >&2
          failed=1
        elif docker info >/dev/null 2>&1; then
          printf '%s\n' 'OK: rootful Docker Engine'
        else
          printf '%s\n' 'NG: Docker Engine に接続できません' >&2
          failed=1
        fi
        ;;
      '')
        printf '%s\n' 'NG: Docker endpoint を確認できません' >&2
        failed=1
        ;;
      *)
        printf '%s\n' 'NG: Docker endpoint はローカルの unix:// socket である必要があります' >&2
        failed=1
        ;;
    esac
    if docker compose version >/dev/null 2>&1; then printf '%s\n' 'OK: Docker Compose plugin'; else printf '%s\n' 'NG: Docker Compose plugin が必要です' >&2; failed=1; fi
  fi
  if command -v nft >/dev/null 2>&1; then
    if printf 'add table inet vpngwgui_host_preparation_check_%s\n' "$$" | nft -c -f - >/dev/null 2>&1; then
      printf '%s\n' 'OK: nftables 構文検査'
    else
      printf '%s\n' 'NG: nft -c による構文検査ができません' >&2
      failed=1
    fi
  fi
  iface=$(hp_read_lan_iface "$hp_repo_root" 2>/dev/null || true)
  if [ -z "$iface" ]; then
    hp_default_route_candidate
    printf '%s\n' 'NG: repository root の .env に LAN_IFACE を一つ設定してください' >&2
    failed=1
  elif ! printf '%s' "$iface" | grep -Eq '^[A-Za-z0-9._-]+$'; then
    printf '%s\n' 'NG: LAN_IFACE に使用できない文字が含まれています' >&2
    failed=1
  elif ! ip link show dev "$iface" >/dev/null 2>&1; then
    printf 'NG: LAN_IFACE がホストにありません: %s\n' "$iface" >&2
    failed=1
  else
    printf 'OK: LAN_IFACE=%s\n' "$iface"
  fi
  [ "$failed" -eq 0 ]
}
