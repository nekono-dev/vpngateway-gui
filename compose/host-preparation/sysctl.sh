#!/bin/sh
# 責務: LAN forwarding sysctl を所有記録付きで適用し、競合のない値だけを復元する
# shellcheck disable=SC2154

hp_sysctl_keys() {
  printf '%s\n' \
    net.ipv4.ip_forward \
    net.ipv4.conf.all.send_redirects \
    net.ipv4.conf.default.send_redirects \
    "net.ipv4.conf.$hp_sysctl_iface.send_redirects"
}

hp_sysctl_current() {
  sysctl -n "$1" 2>/dev/null | tr -d '[:space:]'
}

hp_sysctl_original() {
  key=$1
  sed -n "s/.*\"key\":\"$key\",\"original\":\"\([01]\)\",\"applied\":\"[01]\".*/\1/p" "$hp_state_path"
}

hp_sysctl_owned_keys() {
  sed 's/},{/}\
{/g' "$hp_state_path" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p'
}

hp_sysctl_record() {
  key=$1
  original=$2
  applied=0
  [ "$key" = net.ipv4.ip_forward ] && applied=1
  record="{\"key\":\"$key\",\"original\":\"$original\",\"applied\":\"$applied\"}"
  if grep -Fq "\"key\":\"$key\"" "$hp_state_path"; then
    return 0
  fi
  if [ -L "$hp_state_path" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_state_path" 2>/dev/null || :)" != 'regular file' ]; then
    printf '%s\n' 'host-preparation: sysctl state が通常ファイルではありません' >&2
    return 1
  fi
  state_tmp=$hp_state_dir/.state-sysctl.$$.tmp
  if ! (umask 077; set -C; : > "$state_tmp") 2>/dev/null; then
    printf '%s\n' 'host-preparation: sysctl state 一時ファイルを排他的に作成できません' >&2
    return 1
  fi
  if grep -Fq '"sysctl":[' "$hp_state_path"; then
    sed "s/]}/,$record]}/" "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
  elif grep -Eq '\}$' "$hp_state_path"; then
    sed "s/}/,\"sysctl\":[$record]}/" "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
  else
    rm -f "$state_tmp"
    printf '%s\n' 'host-preparation: sysctl state の形式が不正です' >&2
    return 1
  fi
  if [ -L "$state_tmp" ] || [ "$(LC_ALL=C stat -c '%F' "$state_tmp" 2>/dev/null || :)" != 'regular file' ]; then
    rm -f "$state_tmp"
    printf '%s\n' 'host-preparation: sysctl state 一時ファイルが安全ではありません' >&2
    return 1
  fi
  chmod 0600 "$state_tmp" || { rm -f "$state_tmp"; return 1; }
  mv -f "$state_tmp" "$hp_state_path"
}

hp_sysctl_config_content() {
  printf '%s\n' \
    '# 責務: LAN ゲートウェイに必要なカーネル転送設定を永続化する' \
    'net.ipv4.ip_forward=1' \
    'net.ipv4.conf.all.send_redirects=0' \
    'net.ipv4.conf.default.send_redirects=0' \
    "net.ipv4.conf.$hp_sysctl_iface.send_redirects=0"
}

hp_sysctl_config_apply() {
  config_dir=${hp_sysctl_config_path%/*}
  if [ -L "$config_dir" ] || [ ! -d "$config_dir" ]; then
    printf 'host-preparation: sysctl 設定 directory がありません: %s\n' "$config_dir" >&2
    return 1
  fi
  if [ -L "$hp_sysctl_config_path" ]; then
    printf '%s\n' 'host-preparation: sysctl 設定ファイルが symlink です' >&2
    return 1
  fi
  config_kind=$(LC_ALL=C stat -c '%F' "$hp_sysctl_config_path" 2>/dev/null || :)
  if [ -n "$config_kind" ]; then
    config_metadata=$(stat -c '%u:%g %a' "$hp_sysctl_config_path" 2>/dev/null || :)
    if [ "$hp_sysctl_had_records" != yes ] || [ "$config_kind" != 'regular file' ] || [ "$config_metadata" != '0:0 600' ] || ! cmp -s "$hp_sysctl_config_path" <<EOF
$(hp_sysctl_config_content)
EOF
    then
      printf '%s\n' 'host-preparation: sysctl 設定ファイルに所有権競合があります' >&2
      return 1
    fi
    return 0
  fi
  config_tmp=$config_dir/.vpngwgui-sysctl.$$.tmp
  if (umask 077; set -C; hp_sysctl_config_content > "$config_tmp") 2>/dev/null; then
    :
  else
    printf '%s\n' 'host-preparation: sysctl 設定一時ファイルを排他的に作成できません' >&2
    return 1
  fi
  if [ -L "$config_tmp" ] || [ "$(LC_ALL=C stat -c '%F' "$config_tmp" 2>/dev/null || :)" != 'regular file' ] || [ "$(stat -c '%u:%g %a' "$config_tmp" 2>/dev/null || :)" != '0:0 600' ]; then
    rm -f "$config_tmp"
    printf '%s\n' 'host-preparation: sysctl 設定一時ファイルが安全ではありません' >&2
    return 1
  fi
  if ln "$config_tmp" "$hp_sysctl_config_path" 2>/dev/null; then
    rm -f "$config_tmp"
    return 0
  fi
  rm -f "$config_tmp"
  printf '%s\n' 'host-preparation: sysctl 設定ファイルを安全に配置できません' >&2
  return 1
}

hp_apply_sysctl() {
  hp_sysctl_iface=$(hp_read_lan_iface "$hp_repo_root") || {
    printf '%s\n' 'host-preparation: sysctl apply の LAN_IFACE を取得できません' >&2
    return 1
  }
  if ! printf '%s' "$hp_sysctl_iface" | grep -Eq '^[A-Za-z0-9._-]+$'; then
    printf '%s\n' 'host-preparation: sysctl apply の LAN_IFACE が不正です' >&2
    return 1
  fi
  hp_state_initialize || return 1
  hp_sysctl_had_records=no
  grep -Fq '"sysctl":[' "$hp_state_path" && hp_sysctl_had_records=yes
  failed=0
  for key in $(hp_sysctl_keys); do
    original=$(hp_sysctl_original "$key")
    current=$(hp_sysctl_current "$key") || current=
    if [ -z "$original" ]; then
      case "$current" in 0|1) ;; *) printf 'host-preparation: sysctl 値を読めません: %s\n' "$key" >&2; failed=1; continue ;; esac
      if ! hp_sysctl_record "$key" "$current"; then failed=1; continue; fi
    fi
  done
  [ "$failed" -eq 0 ] || return 1
  if ! hp_sysctl_config_apply; then return 1; fi
  for key in $(hp_sysctl_keys); do
    current=$(hp_sysctl_current "$key") || current=
    target=0
    [ "$key" = net.ipv4.ip_forward ] && target=1
    if [ "$current" != "$target" ] && [ "$current" != "$(hp_sysctl_original "$key")" ]; then
      printf 'host-preparation: sysctl ownership drift: %s (current=%s)\n' "$key" "${current:-unknown}" >&2
      failed=1
      continue
    fi
    if [ "$current" != "$target" ]; then
      if sysctl -w "$key=$target" >/dev/null 2>&1; then
        printf '適用済み: sysctl %s=%s\n' "$key" "$target"
      else
        printf 'host-preparation: sysctl apply に失敗しました: %s\n' "$key" >&2
        failed=1
      fi
    fi
  done
  [ "$failed" -eq 0 ]
}

hp_remove_sysctl() {
  if [ ! -f "$hp_state_path" ] || [ -L "$hp_state_path" ]; then
    printf '%s\n' 'host-preparation: sysctl 所有 state がありません' >&2
    return 1
  fi
  hp_sysctl_iface=
  for key in $(hp_sysctl_owned_keys); do
    case "$key" in
      net.ipv4.conf.*.send_redirects)
        hp_sysctl_iface=${key#net.ipv4.conf.}
        hp_sysctl_iface=${hp_sysctl_iface%.send_redirects}
        ;;
    esac
  done
  failed=0
  for key in $(hp_sysctl_owned_keys); do
    original=$(hp_sysctl_original "$key")
    [ -n "$original" ] || continue
    current=$(hp_sysctl_current "$key") || current=
    target=0
    [ "$key" = net.ipv4.ip_forward ] && target=1
    if [ "$current" = "$original" ]; then
      continue
    fi
    if [ "$current" != "$target" ]; then
      printf 'host-preparation: sysctl ownership conflict; 保持します: %s (current=%s)\n' "$key" "${current:-unknown}" >&2
      failed=1
      continue
    fi
    if ! sysctl -w "$key=$original" >/dev/null 2>&1; then
      printf 'host-preparation: sysctl restore に失敗しました: %s\n' "$key" >&2
      failed=1
    fi
  done
  if [ -L "$hp_sysctl_config_path" ]; then
    printf '%s\n' 'host-preparation: sysctl 設定ファイルが symlink のため保持します' >&2
    failed=1
  elif [ -e "$hp_sysctl_config_path" ]; then
    if [ "$(LC_ALL=C stat -c '%F' "$hp_sysctl_config_path" 2>/dev/null || :)" = 'regular file' ] && [ "$(stat -c '%u:%g %a' "$hp_sysctl_config_path" 2>/dev/null || :)" = '0:0 600' ] && cmp -s "$hp_sysctl_config_path" <<EOF
$(hp_sysctl_config_content)
EOF
    then
      rm -f "$hp_sysctl_config_path" || failed=1
    else
      printf '%s\n' 'host-preparation: sysctl 設定ファイルが変更済みのため保持します' >&2
      failed=1
    fi
  fi
  [ "$failed" -eq 0 ]
}
