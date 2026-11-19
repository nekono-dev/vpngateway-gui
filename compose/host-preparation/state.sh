#!/bin/sh
# 責務: ホスト準備の所有状態ファイルを root 専用権限で初期化する
# shellcheck disable=SC2154

hp_state_path=$hp_state_dir/state.json

# state.json は version を先頭に置く1行 JSON とする。root key は version/sysctl/boot_guard/host_reboot/docker_forward のみ許可し、
# sysctl は key/original/applied、boot_guard は interface/任意の previous_interface/status、
# host_reboot は status/directory/directory_identity/helper/path_unit/service_unit/enable_link/spool の順で記録する。
hp_state_validate() {
  if ! awk 'END { exit NR == 1 ? 0 : 1 }' "$hp_state_path"; then
    printf '%s\n' 'host-preparation: state の形式が不正です（1行 JSON ではありません）' >&2
    return 1
  fi
  if ! awk '
    function whitespace() { while (substr(text, pos, 1) ~ /[[:space:]]/) pos++ }
    function string(    c, escaped) {
      if (substr(text, pos, 1) != "\"") return 0
      pos++
      while (pos <= length(text)) {
        c = substr(text, pos++, 1)
        if (c == "\"") return 1
        if (c == "\\") {
          escaped = substr(text, pos++, 1)
          if (escaped !~ /["\\\/bfnrtu]/) return 0
          if (escaped == "u") {
            if (substr(text, pos, 4) !~ /^[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]$/) return 0
            pos += 4
          }
        } else if (c ~ /[[:cntrl:]]/) return 0
      }
      return 0
    }
    function value(    c, number) {
      whitespace(); c = substr(text, pos, 1)
      if (c == "\"") return string()
      if (c == "{") return object()
      if (c == "[") return array()
      if (substr(text, pos, 4) == "true") { pos += 4; return 1 }
      if (substr(text, pos, 5) == "false") { pos += 5; return 1 }
      if (substr(text, pos, 4) == "null") { pos += 4; return 1 }
      number = substr(text, pos)
      if (match(number, /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/)) { pos += RLENGTH; return 1 }
      return 0
    }
    function object(    c) {
      pos++; whitespace()
      if (substr(text, pos, 1) == "}") { pos++; return 1 }
      while (1) {
        whitespace(); if (!string()) return 0
        whitespace(); if (substr(text, pos++, 1) != ":") return 0
        if (!value()) return 0
        whitespace(); c = substr(text, pos++, 1)
        if (c == "}") return 1
        if (c != ",") return 0
      }
    }
    function array(    c) {
      pos++; whitespace()
      if (substr(text, pos, 1) == "]") { pos++; return 1 }
      while (1) {
        if (!value()) return 0
        whitespace(); c = substr(text, pos++, 1)
        if (c == "]") return 1
        if (c != ",") return 0
      }
    }
    {
      if (NR != 1) exit 1
      text = $0; pos = 1
      if (!value()) exit 1
      whitespace(); if (pos <= length(text)) exit 1
      if (text !~ /^\{"version":1([,}])/) exit 1
      residue = text
      while (match(residue, /"[A-Za-z_][A-Za-z0-9_]*"[[:space:]]*:/)) {
        key = substr(residue, RSTART, RLENGTH)
        if (key !~ /^"(version|sysctl|boot_guard|host_reboot|docker_forward|key|original|applied|interface|previous_interface|lan_iface|status|directory|directory_identity|helper|path_unit|service_unit|enable_link|spool)"[[:space:]]*:/) exit 1
        residue = substr(residue, RSTART + RLENGTH)
      }
      if (text ~ /"boot_guard":\{/ && text !~ /"boot_guard":\{("interface"|"lan_iface"):"[A-Za-z0-9._-]+"(,"previous_interface":"[A-Za-z0-9._-]+")?,"status":"(pending|applied|absent)"\}/) exit 1
      if (text ~ /"boot_guard":\{[^}]*"previous_interface"/ && text !~ /"boot_guard":\{"interface":"[A-Za-z0-9._-]+","previous_interface":"[A-Za-z0-9._-]+","status":"pending"\}/) exit 1
      if (text ~ /"host_reboot":\{/ && text !~ /"host_reboot":\{"status":"(pending|applied|absent)","directory":"[A-Za-z0-9._/:+-]+","directory_identity":"([0-9:]+|missing)","helper":"[A-Za-z0-9._/:+-]+","path_unit":"[A-Za-z0-9._/:+-]+","service_unit":"[A-Za-z0-9._/:+-]+","enable_link":"[A-Za-z0-9._/:+-]+","spool":"[A-Za-z0-9._/:+-]+"\}/) exit 1
      if (text ~ /"docker_forward":\{/ && text !~ /"docker_forward":\{"status":"(pending|applied)"\}/) exit 1
      if (text ~ /"sysctl":/ && text !~ /"sysctl":\[(\{"key":"(net\.ipv4\.ip_forward|net\.ipv4\.conf\.(all|default|[A-Za-z0-9._-]+)\.send_redirects)","original":"[01]","applied":"[01]"\}(,\{"key":"(net\.ipv4\.ip_forward|net\.ipv4\.conf\.(all|default|[A-Za-z0-9._-]+)\.send_redirects)","original":"[01]","applied":"[01]"\})*)?\]/) exit 1
    }
    END { if (NR != 1) exit 1 }
  ' "$hp_state_path"; then
    printf '%s\n' 'host-preparation: state の形式が不正または未知の version です' >&2
    return 1
  fi
  for hp_state_key in version sysctl boot_guard host_reboot docker_forward; do
    hp_state_count=$(awk -v key="\"$hp_state_key\"" '{ line=$0; while (sub(key, "", line)) count++ } END { print count+0 }' "$hp_state_path")
    if [ "$hp_state_key" = version ]; then
      [ "$hp_state_count" -eq 1 ] || { printf '%s\n' 'host-preparation: state key が重複または欠落しています: version' >&2; return 1; }
    elif [ "$hp_state_count" -gt 1 ]; then
      printf 'host-preparation: state key が重複しています: %s\n' "$hp_state_key" >&2
      return 1
    fi
  done
  return 0
}

hp_state_initialize() {
  if [ "$(id -u)" -ne 0 ]; then
    printf '%s\n' 'host-preparation: state 初期化には root が必要です' >&2
    return 1
  fi
  if [ -L "$hp_state_dir" ]; then
    printf '%s\n' 'host-preparation: state directory が symlink です' >&2
    return 1
  fi
  if ! stat -c '%F' "$hp_state_dir" >/dev/null 2>&1; then
    (umask 077; mkdir "$hp_state_dir") || {
      printf '%s\n' 'host-preparation: state directory を安全に作成できません' >&2
      return 1
    }
  fi
  state_kind=$(LC_ALL=C stat -c '%F' "$hp_state_dir" 2>/dev/null) || state_kind=
  if [ -L "$hp_state_dir" ] || [ "$state_kind" != directory ]; then
    printf '%s\n' 'host-preparation: state directory が安全な directory ではありません' >&2
    return 1
  fi
  if [ -L "$hp_state_path" ]; then
    printf '%s\n' 'host-preparation: state が通常ファイルではありません' >&2
    return 1
  fi
  state_kind=$(LC_ALL=C stat -c '%F' "$hp_state_path" 2>/dev/null) || state_kind=
  if [ -n "$state_kind" ] && [ "$state_kind" != 'regular file' ]; then
    printf '%s\n' 'host-preparation: state が通常ファイルではありません' >&2
    return 1
  fi
  state_metadata=$(stat -c '%u:%g %a' "$hp_state_dir") || {
    printf '%s\n' 'host-preparation: state directory の所有状態を確認できません' >&2
    return 1
  }
  if [ "$state_metadata" != '0:0 700' ]; then
    printf '%s\n' 'host-preparation: state directory は root:root、mode 0700 が必要です' >&2
    return 1
  fi
  if [ -n "$state_kind" ]; then
    state_metadata=$(stat -c '%u:%g %a' "$hp_state_path") || {
      printf '%s\n' 'host-preparation: state の所有状態を確認できません' >&2
      return 1
    }
    if [ "$state_metadata" != '0:0 600' ]; then
      printf '%s\n' 'host-preparation: state は root:root、mode 0600 が必要です' >&2
      return 1
    fi
    hp_state_validate || return 1
    return 0
  fi
  attempt=0
  while [ "$attempt" -lt 10 ]; do
    attempt=$((attempt + 1))
    state_tmp=$hp_state_dir/.state.json.$$.${attempt}
    if (umask 077; set -C; printf '{"version":1}\n' > "$state_tmp") 2>/dev/null; then
      break
    fi
    state_tmp=
  done
  if [ -z "$state_tmp" ]; then
    printf '%s\n' 'host-preparation: 一時 state を排他的に作成できません' >&2
    return 1
  fi
  state_metadata=$(stat -c '%u:%g %a' "$state_tmp") || {
    rm -f "$state_tmp"
    printf '%s\n' 'host-preparation: 一時 state の所有状態を確認できません' >&2
    return 1
  }
  if [ "$state_metadata" != '0:0 600' ]; then
    rm -f "$state_tmp"
    printf '%s\n' 'host-preparation: 一時 state の権限が不正です' >&2
    return 1
  fi
  if ln "$state_tmp" "$hp_state_path" 2>/dev/null; then
    rm -f "$state_tmp"
    return 0
  fi
  rm -f "$state_tmp"
  if [ ! -L "$hp_state_path" ]; then
    state_kind=$(LC_ALL=C stat -c '%F' "$hp_state_path" 2>/dev/null) || state_kind=
    if [ "$state_kind" = 'regular file' ]; then
      state_metadata=$(stat -c '%u:%g %a' "$hp_state_path" 2>/dev/null) || state_metadata=
      if [ "$state_metadata" = '0:0 600' ]; then
        hp_state_validate || return 1
        return 0
      fi
    fi
  fi
  printf '%s\n' 'host-preparation: state を配置できません' >&2
  return 1
}
