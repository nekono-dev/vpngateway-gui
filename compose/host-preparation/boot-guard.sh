#!/bin/sh
# 責務: LAN_IFACE を記録し、起動時に初期 BLOCK を適用する systemd boot guard を管理する
# state.json の boot_guard は遷移中に target と直前の適用値を保持する
# shellcheck disable=SC2154

hp_boot_guard_unit_name=vpngwgui-boot-guard.service

hp_boot_guard_recorded_iface() {
  sed -n 's/.*"boot_guard":{"interface":"\([A-Za-z0-9._-][A-Za-z0-9._-]*\)".*}.*/\1/p; s/.*"boot_guard":{"lan_iface":"\([A-Za-z0-9._-][A-Za-z0-9._-]*\)".*}.*/\1/p' "$hp_state_path"
}

hp_boot_guard_previous_iface() {
  sed -n 's/.*"boot_guard":{"interface":"[A-Za-z0-9._-][A-Za-z0-9._-]*","previous_interface":"\([A-Za-z0-9._-][A-Za-z0-9._-]*\)","status":"pending"}.*/\1/p' "$hp_state_path"
}

hp_boot_guard_recorded_status() {
  sed -n 's/.*"boot_guard":{"interface":"[A-Za-z0-9._-][A-Za-z0-9._-]*"\(,"previous_interface":"[A-Za-z0-9._-][A-Za-z0-9._-]*"\)\?,"status":"\(pending\|applied\)"}.*/\2/p; s/.*"boot_guard":{"lan_iface":"[A-Za-z0-9._-][A-Za-z0-9._-]*","status":"\(pending\|applied\)"}.*/\1/p' "$hp_state_path"
}

hp_boot_guard_state_record() {
  iface=$1
  status=$2
  previous=${3-}
  case "$status:$previous" in pending:|pending:*) ;; applied:) previous= ;; *) return 1 ;; esac
  if [ -L "$hp_state_path" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_state_path" 2>/dev/null || :)" != 'regular file' ]; then
    printf '%s\n' 'host-preparation: boot guard state が通常ファイルではありません' >&2
    return 1
  fi
  if [ "$(stat -c '%u:%g %a' "$hp_state_path" 2>/dev/null || :)" != '0:0 600' ]; then
    printf '%s\n' 'host-preparation: boot guard state の所有権または mode が不正です' >&2
    return 1
  fi
  recorded=$(hp_boot_guard_recorded_iface)
  recorded_status=$(hp_boot_guard_recorded_status)
  if [ -n "$recorded" ]; then
    recorded_previous=$(hp_boot_guard_previous_iface)
    if [ "$recorded" = "$iface" ] && [ "$recorded_status" = "$status" ] && [ "$recorded_previous" = "$previous" ]; then return 0; fi
  elif grep -Fq '"boot_guard"' "$hp_state_path"; then
    printf '%s\n' 'host-preparation: boot guard state の LAN_IFACE 記録が不正です' >&2
    return 1
  fi
  state_tmp=
  attempt=0
  while [ "$attempt" -lt 10 ]; do
    attempt=$((attempt + 1))
    state_tmp=$hp_state_dir/.state-boot-guard.$$.${attempt}
    if (umask 077; set -C; : > "$state_tmp") 2>/dev/null; then break; fi
    state_tmp=
  done
  if [ -z "$state_tmp" ]; then
    printf '%s\n' 'host-preparation: boot guard state 一時ファイルを排他的に作成できません' >&2
    return 1
  fi
  replacement="\"boot_guard\":{\"interface\":\"$iface\""
  if [ "$status" = pending ] && [ -n "$previous" ]; then replacement="$replacement,\"previous_interface\":\"$previous\""; fi
  replacement="$replacement,\"status\":\"$status\"}"
  if [ -n "$recorded" ]; then
    if grep -Fq '"interface"' "$hp_state_path"; then
      sed "s/\"boot_guard\":{[^}]*}/$replacement/" "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
    else
      sed "s/\"boot_guard\":{[^}]*}/$replacement/" "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
    fi
  elif grep -Eq '\}$' "$hp_state_path"; then
    sed "s/}\$/,$replacement}/" "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
  else
    rm -f "$state_tmp"
    printf '%s\n' 'host-preparation: boot guard state の形式が不正です' >&2
    return 1
  fi
  if [ -L "$state_tmp" ] || [ "$(LC_ALL=C stat -c '%F' "$state_tmp" 2>/dev/null || :)" != 'regular file' ] || [ "$(stat -c '%u:%g %a' "$state_tmp" 2>/dev/null || :)" != '0:0 600' ]; then
    rm -f "$state_tmp"
    printf '%s\n' 'host-preparation: boot guard state 一時ファイルが安全ではありません' >&2
    return 1
  fi
  if ! grep -Fq "$replacement" "$state_tmp"; then
    rm -f "$state_tmp"
    printf '%s\n' 'host-preparation: boot guard state を記録できません' >&2
    return 1
  fi
  mv -f "$state_tmp" "$hp_state_path"
}

hp_boot_guard_unit_content() {
  cat <<EOF
[Unit]
Description=LAN 転送の初期遮断
Wants=nftables.service
After=nftables.service
Before=network-pre.target docker.service docker.socket

[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f $hp_boot_guard_rules_path
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
RequiredBy=docker.service
EOF
}

hp_boot_guard_verify_docker_dependency() {
  requires_directory=${hp_boot_guard_docker_requires_path%/*}
  if [ -L "$requires_directory" ] ||
    { [ -e "$requires_directory" ] && [ "$(LC_ALL=C stat -c '%F' "$requires_directory" 2>/dev/null || :)" != directory ]; } ||
    [ ! -L "$hp_boot_guard_docker_requires_path" ] ||
    [ "$(readlink "$hp_boot_guard_docker_requires_path" 2>/dev/null || :)" != "$hp_boot_guard_unit_path" ]; then
    printf '%s\n' 'host-preparation: Docker の boot guard 依存リンクがないか、製品所有ではありません' >&2
    return 1
  fi
  required_by=$(systemctl show -p RequiredBy --value "$hp_boot_guard_unit_name" 2>/dev/null) || required_by=
  case " $required_by " in
    *' docker.service '*) return 0 ;;
    *)
      printf '%s\n' 'host-preparation: Docker 依存関係を確認できません' >&2
      return 1
      ;;
  esac
}

hp_boot_guard_check_docker_dependency_path() {
  requires_directory=${hp_boot_guard_docker_requires_path%/*}
  if [ -L "$requires_directory" ] ||
    { [ -e "$requires_directory" ] && [ "$(LC_ALL=C stat -c '%F' "$requires_directory" 2>/dev/null || :)" != directory ]; }; then
    printf '%s\n' 'host-preparation: Docker requires directory が安全ではありません' >&2
    return 1
  fi
  if [ -e "$hp_boot_guard_docker_requires_path" ] || [ -L "$hp_boot_guard_docker_requires_path" ]; then
    if [ ! -L "$hp_boot_guard_docker_requires_path" ] || [ "$(readlink "$hp_boot_guard_docker_requires_path" 2>/dev/null || :)" != "$hp_boot_guard_unit_path" ]; then
      printf '%s\n' 'host-preparation: Docker dependency link が外部所有のため保持します' >&2
      return 1
    fi
  fi
  return 0
}

hp_boot_guard_bootstrap_content() {
  cat <<EOF
add table inet vpngwgui_guard
add set inet vpngwgui_guard healthy_lease4 { type ifname; flags timeout; }
add chain inet vpngwgui_guard guard_forward { type filter hook forward priority -1; policy accept; }
EOF
}

hp_boot_guard_block_content() {
  iface=$1
  cat <<EOF
flush chain inet vpngwgui_guard guard_forward
flush set inet vpngwgui_guard healthy_lease4
add rule inet vpngwgui_guard guard_forward iifname "$iface" drop
EOF
}

hp_boot_guard_apply_content() {
  iface=$1
  hp_boot_guard_bootstrap_content
  hp_boot_guard_block_content "$iface"
}

hp_boot_guard_ensure_parent() {
  directory=$1
  if [ -L "$directory" ]; then
    printf 'host-preparation: boot guard directory が symlink です: %s\n' "$directory" >&2
    return 1
  fi
  if [ -e "$directory" ]; then
    if [ "$(LC_ALL=C stat -c '%F' "$directory" 2>/dev/null || :)" != directory ]; then
      printf 'host-preparation: boot guard directory が通常 directory ではありません: %s\n' "$directory" >&2
      return 1
    fi
    if [ "$(stat -c '%u:%g %a' "$directory" 2>/dev/null || :)" != '0:0 755' ]; then
      printf 'host-preparation: boot guard directory の owner/mode が不正です: %s\n' "$directory" >&2
      return 1
    fi
    return 0
  fi
  (umask 022; mkdir "$directory") || {
    printf 'host-preparation: boot guard directory を作成できません: %s\n' "$directory" >&2
    return 1
  }
  if ! chmod 0755 "$directory" || ! chown root:root "$directory"; then return 1; fi
  [ "$(stat -c '%u:%g %a' "$directory" 2>/dev/null || :)" = '0:0 755' ]
}

hp_boot_guard_install_file() {
  destination=$1
  mode=$2
  content_function=$3
  content_argument=${4-}
  directory=${destination%/*}
  hp_boot_guard_ensure_parent "$directory" || return 1
  if [ -L "$destination" ]; then
    printf 'host-preparation: boot guard file が symlink です: %s\n' "$destination" >&2
    return 1
  fi
  existing_kind=$(LC_ALL=C stat -c '%F' "$destination" 2>/dev/null || :)
  if [ -n "$existing_kind" ]; then
    expected_tmp=$directory/.vpngwgui-boot-guard-expected.$$.tmp
    if ! (umask 077; set -C; "$content_function" "$content_argument" > "$expected_tmp") 2>/dev/null; then return 1; fi
    if [ "$existing_kind" = 'regular file' ] && [ "$(stat -c '%u:%g %a' "$destination" 2>/dev/null || :)" = "0:0 $mode" ] && cmp -s "$destination" "$expected_tmp"; then
      rm -f "$expected_tmp"
      return 0
    fi
    rm -f "$expected_tmp"
    printf 'host-preparation: boot guard file に所有権競合があります: %s\n' "$destination" >&2
    return 1
  fi
  temporary_file=$directory/.vpngwgui-boot-guard.$$.tmp
  if ! (umask 077; set -C; "$content_function" "$content_argument" > "$temporary_file") 2>/dev/null; then
    printf 'host-preparation: boot guard 一時ファイルを作成できません: %s\n' "$destination" >&2
    return 1
  fi
  if [ -L "$temporary_file" ] || [ "$(LC_ALL=C stat -c '%F' "$temporary_file" 2>/dev/null || :)" != 'regular file' ]; then
    rm -f "$temporary_file"
    return 1
  fi
  if ! chmod "$mode" "$temporary_file" || ! chown root:root "$temporary_file"; then
    rm -f "$temporary_file"
    return 1
  fi
  if [ "$(stat -c '%u:%g %a' "$temporary_file" 2>/dev/null || :)" != "0:0 $mode" ] || ! ln "$temporary_file" "$destination" 2>/dev/null; then
    rm -f "$temporary_file"
    printf 'host-preparation: boot guard file を安全に配置できません: %s\n' "$destination" >&2
    return 1
  fi
  rm -f "$temporary_file"
}

hp_boot_guard_update_rules_file() {
  previous_iface=$1
  current_iface=$2
  hp_boot_guard_ensure_parent "${hp_boot_guard_rules_path%/*}" || return 1
  if [ -L "$hp_boot_guard_rules_path" ] ||
    [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != 'regular file' ] ||
    [ "$(stat -c '%u:%g %a' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != '0:0 600' ]; then
    printf '%s\n' 'host-preparation: boot guard rules が安全な通常ファイルではありません' >&2
    return 1
  fi
  expected=$hp_state_dir/.boot-guard-rules-old.$$.tmp
  replacement=${hp_boot_guard_rules_path%/*}/.vpngwgui-boot-guard-update.$$.tmp
  if ! (umask 077; set -C; hp_boot_guard_apply_content "$previous_iface" > "$expected") 2>/dev/null; then return 1; fi
  current_expected=$hp_state_dir/.boot-guard-rules-current.$$.tmp
  if ! (umask 077; set -C; hp_boot_guard_apply_content "$current_iface" > "$current_expected") 2>/dev/null; then
    rm -f "$expected"
    return 1
  fi
  if ! cmp -s "$hp_boot_guard_rules_path" "$expected" && ! cmp -s "$hp_boot_guard_rules_path" "$current_expected"; then
    rm -f "$expected" "$current_expected"
    printf '%s\n' 'host-preparation: boot guard rules に所有権競合があります' >&2
    return 1
  fi
  if ! (umask 077; set -C; hp_boot_guard_apply_content "$current_iface" > "$replacement") 2>/dev/null; then
    rm -f "$expected" "$current_expected"
    return 1
  fi
  if [ -L "$hp_boot_guard_rules_path" ] || (! cmp -s "$hp_boot_guard_rules_path" "$expected" && ! cmp -s "$hp_boot_guard_rules_path" "$current_expected") ||
    ! chmod 0600 "$replacement" || ! chown root:root "$replacement" ||
    [ "$(stat -c '%u:%g %a' "$replacement" 2>/dev/null || :)" != '0:0 600' ] ||
    ! mv -f "$replacement" "$hp_boot_guard_rules_path"; then
    rm -f "$expected" "$current_expected" "$replacement"
    printf '%s\n' 'host-preparation: boot guard rules を安全に更新できません' >&2
    return 1
  fi
  rm -f "$expected" "$current_expected"
}

hp_boot_guard_verify_resources() {
  table_output=$(nft list table inet vpngwgui_guard 2>/dev/null) || {
    printf '%s\n' 'host-preparation: boot guard table を確認できません' >&2
    return 1
  }
  if printf '%s\n' "$table_output" | grep -Fq 'table inet vpngwgui_guard' &&
    printf '%s\n' "$table_output" | grep -Fq 'healthy_lease4' &&
    printf '%s\n' "$table_output" | grep -Fq 'type ifname' &&
    printf '%s\n' "$table_output" | grep -Fq 'flags timeout' &&
    printf '%s\n' "$table_output" | grep -Fq 'chain guard_forward' &&
    printf '%s\n' "$table_output" | grep -Eq 'hook forward priority (filter - 1|-1); policy accept;'; then
    return 0
  fi
  printf '%s\n' 'host-preparation: boot guard table/chain の確認に失敗しました' >&2
  return 1
}

hp_boot_guard_verify_owned_table() {
  iface=$1
  printf '%s\n' "$table_output" | awk -v iface="$iface" '
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      return value
    }
    function valid_element(value, count, fields) {
      value = trim(value)
      count = split(value, fields, /[[:space:]]+/)
      if (count != 3 && count != 5) return 0
      if (fields[1] != "\"" iface "\"" || fields[2] != "timeout" || fields[3] != "4s") return 0
      if (count == 3) return 1
      return fields[4] == "expires" && fields[5] ~ /^([0-9]+(ms|s|m|h|d))+$/
    }
    {
      line = trim($0)
      if (line == "table inet vpngwgui_guard {") { table_count++; next }
      if (line == "set healthy_lease4 {") { set_count++; section = "set"; next }
      if (line == "chain guard_forward {") { chain_count++; section = "chain"; next }
      if (section == "set" && elements_open) {
        if (line ~ /}/) {
          close_position = index(line, "}")
          if (substr(line, close_position + 1) !~ /^[[:space:]]*$/) invalid = 1
          line = substr(line, 1, close_position - 1)
          element_value = element_value " " line
          elements_open = 0
          if (valid_element(element_value)) lease_element++; else invalid = 1
          next
        }
        element_value = element_value " " line
        next
      }
      if (line == "}") { section = ""; close_count++; next }
      if (section == "set" && line == "type ifname") { set_type++; next }
      if (section == "set" && line == "flags timeout") { set_flags++; next }
      if (section == "set" && line ~ /^elements[[:space:]]*=[[:space:]]*\{/) {
        sub(/^elements[[:space:]]*=[[:space:]]*\{/, "", line)
        if (line ~ /}/) {
          close_position = index(line, "}")
          if (substr(line, close_position + 1) !~ /^[[:space:]]*$/) invalid = 1
          line = substr(line, 1, close_position - 1)
          if (valid_element(line)) lease_element++; else invalid = 1
        } else {
          element_value = line
          elements_open = 1
        }
        next
      }
      if (section == "chain" && (line == "type filter hook forward priority -1; policy accept;" || line == "type filter hook forward priority filter - 1; policy accept;")) { chain_type++; next }
      if (section == "chain" && line == "iifname \"" iface "\" drop") { drop_rule++; next }
      if (section == "chain" && line == "iifname @healthy_lease4 return") { return_rule++; next }
      invalid = 1
    }
    END {
      if (invalid || table_count != 1 || set_count != 1 || chain_count != 1 || close_count != 3 || set_type != 1 || set_flags != 1 || chain_type != 1) exit 1
      if (lease_element == 0 && return_rule == 0 && drop_rule == 1) exit 0
      if (lease_element == 1 && return_rule == 1 && drop_rule == 1) exit 0
      if (lease_element == 0 && return_rule == 0 && drop_rule == 0) exit 0
      exit 1
    }
  '
}

hp_boot_guard_verify_table() {
  iface=$1
  if hp_boot_guard_verify_resources && printf '%s\n' "$table_output" | grep -Fq "iifname \"$iface\" drop"; then
    return 0
  fi
  printf '%s\n' 'host-preparation: boot guard table/chain/BLOCK rule の確認に失敗しました' >&2
  return 1
}

hp_apply_boot_guard() {
  current_iface=$(hp_read_lan_iface "$hp_repo_root") || {
    printf '%s\n' 'host-preparation: boot guard apply の LAN_IFACE を取得できません' >&2
    return 1
  }
  if ! printf '%s' "$current_iface" | grep -Eq '^[A-Za-z0-9._-]+$' || ! ip link show dev "$current_iface" >/dev/null 2>&1; then
    printf '%s\n' 'host-preparation: boot guard apply の LAN_IFACE が不正または存在しません' >&2
    return 1
  fi
  hp_boot_guard_check_docker_dependency_path || return 1
  table_exists=0
  if nft list table inet vpngwgui_guard >/dev/null 2>&1; then table_exists=1; fi
  if [ "$table_exists" -eq 1 ] && [ ! -e "$hp_state_path" ] && [ ! -L "$hp_state_path" ]; then
    printf '%s\n' 'host-preparation: 既存 boot guard table に所有 state がないため競合として保持します' >&2
    return 1
  fi
  hp_state_initialize || return 1
  if [ "$table_exists" -eq 1 ]; then
    recorded_iface=$(hp_boot_guard_recorded_iface)
    recorded_previous=$(hp_boot_guard_previous_iface)
    recorded_status=$(hp_boot_guard_recorded_status)
    if [ -z "$recorded_iface" ] || ! printf '%s' "$recorded_iface" | grep -Eq '^[A-Za-z0-9._-]+$' ||
      { grep -Fq '"interface"' "$hp_state_path" && { [ "$recorded_status" != pending ] && [ "$recorded_status" != applied ]; }; } ||
      { [ -n "$recorded_previous" ] && { [ "$recorded_status" != pending ] || ! printf '%s' "$recorded_previous" | grep -Eq '^[A-Za-z0-9._-]+$'; }; } ||
      ! grep -Fq '"boot_guard"' "$hp_state_path" ||
      ! awk '{ line = $0; while (sub(/"boot_guard"/, "", line)) count++ } END { exit count == 1 ? 0 : 1 }' "$hp_state_path" ||
      ! hp_boot_guard_verify_resources; then
      printf '%s\n' 'host-preparation: 既存 boot guard table が所有記録と一致しないため競合として保持します' >&2
      return 1
    fi
    owned_interface=$recorded_iface
    if ! hp_boot_guard_verify_owned_table "$owned_interface"; then
      if [ "$recorded_status" = pending ] && [ -n "$recorded_previous" ] &&
        hp_boot_guard_verify_owned_table "$recorded_previous"; then
        owned_interface=$recorded_previous
      else
        printf '%s\n' 'host-preparation: 既存 boot guard table が所有記録と一致しないため競合として保持します' >&2
        return 1
      fi
    fi
    if [ "$recorded_status" = pending ] && [ -n "$recorded_previous" ]; then
      if [ -L "$hp_boot_guard_rules_path" ] ||
        [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != 'regular file' ] ||
        [ "$(stat -c '%u:%g %a' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != '0:0 600' ]; then
        printf '%s\n' 'host-preparation: pending boot guard rules が安全な通常ファイルではありません' >&2
        return 1
      fi
      rules_target=$hp_state_dir/.boot-guard-rules-target.$$.tmp
      rules_previous=$hp_state_dir/.boot-guard-rules-previous.$$.tmp
      if ! (umask 077; set -C; hp_boot_guard_apply_content "$recorded_iface" > "$rules_target") 2>/dev/null ||
        ! (umask 077; set -C; hp_boot_guard_apply_content "$recorded_previous" > "$rules_previous") 2>/dev/null; then
        rm -f "$rules_target" "$rules_previous"
        return 1
      fi
      if ! cmp -s "$hp_boot_guard_rules_path" "$rules_target" && ! cmp -s "$hp_boot_guard_rules_path" "$rules_previous"; then
        rm -f "$rules_target" "$rules_previous"
        printf '%s\n' 'host-preparation: pending boot guard rules が所有記録と一致しないため競合として保持します' >&2
        return 1
      fi
      rm -f "$rules_target" "$rules_previous"
    elif ! hp_boot_guard_verify_owned_table "$recorded_iface"; then
      printf '%s\n' 'host-preparation: 既存 boot guard table が所有記録と一致しないため競合として保持します' >&2
      return 1
    fi
  fi
  if [ "$table_exists" -eq 1 ] && [ "$recorded_iface" != "$current_iface" ]; then
    hp_boot_guard_state_record "$current_iface" pending "$owned_interface" || return 1
    hp_boot_guard_update_rules_file "$owned_interface" "$current_iface" || return 1
  elif [ "$table_exists" -eq 1 ] && [ "$recorded_status" = pending ] && [ -n "$recorded_previous" ]; then
    hp_boot_guard_update_rules_file "$owned_interface" "$current_iface" || return 1
  else
    hp_boot_guard_state_record "$current_iface" pending || return 1
    hp_boot_guard_install_file "$hp_boot_guard_rules_path" 600 hp_boot_guard_apply_content "$current_iface" || return 1
  fi
  hp_boot_guard_install_file "$hp_boot_guard_unit_path" 644 hp_boot_guard_unit_content || return 1
  hp_boot_guard_ensure_parent "${hp_boot_guard_docker_requires_path%/*}" || return 1
  systemctl daemon-reload || { printf '%s\n' 'host-preparation: boot guard systemd unit を再読込できません' >&2; return 1; }
  systemctl enable "$hp_boot_guard_unit_name" >/dev/null || { printf '%s\n' 'host-preparation: boot guard unit を有効化できません' >&2; return 1; }
  hp_boot_guard_verify_docker_dependency || return 1
  if [ "$table_exists" -eq 1 ]; then
    nft_block_tmp=$hp_state_dir/.boot-guard-block.$$.nft
    if ! (umask 077; set -C; hp_boot_guard_block_content "$current_iface" > "$nft_block_tmp") 2>/dev/null; then return 1; fi
    nft -f "$nft_block_tmp" || { rm -f "$nft_block_tmp"; printf '%s\n' 'host-preparation: boot guard 初期 BLOCK を更新できません' >&2; return 1; }
    rm -f "$nft_block_tmp"
  else
    nft -f "$hp_boot_guard_rules_path" || { printf '%s\n' 'host-preparation bootstrap/BLOCK を適用できません' >&2; return 1; }
  fi
  systemctl is-enabled "$hp_boot_guard_unit_name" >/dev/null 2>&1 || { printf '%s\n' 'host-preparation: boot guard unit の有効化を確認できません' >&2; return 1; }
  if hp_boot_guard_verify_resources && hp_boot_guard_verify_owned_table "$current_iface" &&
    printf '%s\n' "$table_output" | grep -Fq "iifname \"$current_iface\" drop" &&
    ! printf '%s\n' "$table_output" | grep -Fq 'elements = {' &&
    ! printf '%s\n' "$table_output" | grep -Fq 'iifname @healthy_lease4 return'; then
    :
  else
      printf '%s\n' 'host-preparation: boot guard table/chain/BLOCK rule の確認に失敗しました' >&2
      return 1
  fi
  hp_boot_guard_state_record "$current_iface" applied || return 1
  printf '適用済み: boot guard BLOCK (%s)\n' "$current_iface"
}

hp_remove_boot_guard() {
  if [ -L "$hp_state_path" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_state_path" 2>/dev/null || :)" != 'regular file' ] || [ "$(stat -c '%u:%g %a' "$hp_state_path" 2>/dev/null || :)" != '0:0 600' ]; then
    printf '%s\n' 'host-preparation: boot guard 所有 state がありません' >&2
    return 1
  fi
  iface=$(hp_boot_guard_recorded_iface)
  if [ -z "$iface" ]; then return 0; fi
  previous_iface=$(hp_boot_guard_previous_iface)
  recorded_status=$(hp_boot_guard_recorded_status)
  if ! printf '%s' "$iface" | grep -Eq '^[A-Za-z0-9._-]+$' ||
    { [ -n "$previous_iface" ] && { [ "$recorded_status" != pending ] || ! printf '%s' "$previous_iface" | grep -Eq '^[A-Za-z0-9._-]+$'; }; } ||
    { [ -z "$previous_iface" ] && [ "$recorded_status" != applied ] && [ "$recorded_status" != pending ]; } ||
    ! grep -Fq '"boot_guard"' "$hp_state_path" ||
    ! awk '{ line = $0; while (sub(/"boot_guard"/, "", line)) count++ } END { exit count == 1 ? 0 : 1 }' "$hp_state_path"; then
    printf '%s\n' 'host-preparation: boot guard state が不正なため解除を中止します' >&2
    return 1
  fi
  table_exists=0
  if nft list table inet vpngwgui_guard >/dev/null 2>&1; then table_exists=1; fi
  if [ "$table_exists" -eq 1 ] &&
    { ! hp_boot_guard_verify_resources ||
      { ! hp_boot_guard_verify_owned_table "$iface" &&
        { [ "$recorded_status" != pending ] || [ -z "$previous_iface" ] || ! hp_boot_guard_verify_owned_table "$previous_iface"; }; }; }; then
    printf '%s\n' 'host-preparation: guard table に所有外または変更済みの内容があるため競合として保持します' >&2
    return 1
  fi
  expected_unit=$hp_state_dir/.boot-guard-remove-unit.$$.tmp
  if ! (umask 077; set -C; hp_boot_guard_unit_content > "$expected_unit") 2>/dev/null; then
    printf '%s\n' 'host-preparation: boot guard unit の所有確認用ファイルを作成できません' >&2
    return 1
  fi
  if [ -L "$hp_boot_guard_unit_path" ]; then
    printf '%s\n' 'host-preparation: boot guard unit が symlink のため保持します' >&2
    rm -f "$expected_unit"
    return 1
  elif [ -e "$hp_boot_guard_unit_path" ]; then
    if [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_unit_path" 2>/dev/null || :)" != 'regular file' ] ||
      [ "$(stat -c '%u:%g %a' "$hp_boot_guard_unit_path" 2>/dev/null || :)" != '0:0 644' ] ||
      ! cmp -s "$hp_boot_guard_unit_path" "$expected_unit"; then
      printf '%s\n' 'host-preparation: boot guard unit が変更済みのため保持します' >&2
      rm -f "$expected_unit"
      return 1
    fi
  fi
  requires_directory=${hp_boot_guard_docker_requires_path%/*}
  if [ -L "$requires_directory" ] ||
    { [ -e "$requires_directory" ] && [ "$(LC_ALL=C stat -c '%F' "$requires_directory" 2>/dev/null || :)" != directory ]; }; then
    printf '%s\n' 'host-preparation: Docker requires directory が安全ではないため保持します' >&2
    rm -f "$expected_unit"
    return 1
  fi
  if [ -e "$hp_boot_guard_docker_requires_path" ] || [ -L "$hp_boot_guard_docker_requires_path" ]; then
    if [ ! -L "$hp_boot_guard_docker_requires_path" ] || [ "$(readlink "$hp_boot_guard_docker_requires_path" 2>/dev/null || :)" != "$hp_boot_guard_unit_path" ]; then
      printf '%s\n' 'host-preparation: Docker dependency link が外部所有のため保持します' >&2
      rm -f "$expected_unit"
      return 1
    fi
  fi
  expected_rules=$hp_state_dir/.boot-guard-remove-rules.$$.tmp
  expected_previous_rules=$hp_state_dir/.boot-guard-remove-previous-rules.$$.tmp
  if ! (umask 077; set -C; hp_boot_guard_apply_content "$iface" > "$expected_rules") 2>/dev/null; then
    rm -f "$expected_unit"
    return 1
  fi
  if [ -n "$previous_iface" ] && ! (umask 077; set -C; hp_boot_guard_apply_content "$previous_iface" > "$expected_previous_rules") 2>/dev/null; then
    rm -f "$expected_unit" "$expected_rules"
    return 1
  fi
  if [ -L "$hp_boot_guard_rules_path" ]; then
    printf '%s\n' 'host-preparation: boot guard rules が symlink のため保持します' >&2
    rm -f "$expected_unit" "$expected_rules" "$expected_previous_rules"
    return 1
  elif [ -e "$hp_boot_guard_rules_path" ]; then
    rules_owned=0
    if [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_rules_path" 2>/dev/null || :)" = 'regular file' ] &&
      [ "$(stat -c '%u:%g %a' "$hp_boot_guard_rules_path" 2>/dev/null || :)" = '0:0 600' ] &&
      { cmp -s "$hp_boot_guard_rules_path" "$expected_rules" ||
        { [ "$recorded_status" = pending ] && [ -n "$previous_iface" ] && cmp -s "$hp_boot_guard_rules_path" "$expected_previous_rules"; }; }; then
      rules_owned=1
    fi
    if [ "$rules_owned" -ne 1 ]; then
      printf '%s\n' 'host-preparation: boot guard rules が変更済みのため保持します' >&2
      rm -f "$expected_unit" "$expected_rules" "$expected_previous_rules"
      return 1
    fi
  fi
  # ここから先は全所有確認済み。guard table は最後に消し、失敗時の再試行経路を残す。
  if [ -e "$hp_boot_guard_unit_path" ] || [ -L "$hp_boot_guard_docker_requires_path" ]; then
    systemctl disable --now "$hp_boot_guard_unit_name" >/dev/null 2>&1 || {
      rm -f "$expected_unit" "$expected_rules" "$expected_previous_rules"
      printf '%s\n' 'host-preparation: boot guard unit を停止・無効化できません。対象は保持しました' >&2
      return 1
    }
  fi
  if [ -L "$hp_boot_guard_docker_requires_path" ] && [ "$(readlink "$hp_boot_guard_docker_requires_path" 2>/dev/null || :)" = "$hp_boot_guard_unit_path" ]; then
    if ! rm -f "$hp_boot_guard_docker_requires_path"; then
      rm -f "$expected_unit" "$expected_rules" "$expected_previous_rules"
      printf '%s\n' 'host-preparation: boot guard unit は停止しましたが Docker dependency link を削除できません。remove を再実行してください' >&2
      return 1
    fi
  fi
  if [ -e "$hp_boot_guard_unit_path" ]; then
    if ! rm -f "$hp_boot_guard_unit_path"; then
      rm -f "$expected_unit" "$expected_rules" "$expected_previous_rules"
      printf '%s\n' 'host-preparation: Docker dependency link を解除しましたが boot guard unit を削除できません。remove を再実行してください' >&2
      return 1
    fi
  fi
  if [ -e "$hp_boot_guard_rules_path" ]; then
    if ! rm -f "$hp_boot_guard_rules_path"; then
      rm -f "$expected_unit" "$expected_rules" "$expected_previous_rules"
      printf '%s\n' 'host-preparation: boot guard unit は解除しましたが rules file を削除できません。remove を再実行してください' >&2
      return 1
    fi
  fi
  rm -f "$expected_unit" "$expected_rules" "$expected_previous_rules"
  if [ "$table_exists" -eq 1 ] && ! nft delete table inet vpngwgui_guard; then
    printf '%s\n' 'host-preparation: boot guard unit と rules は撤去しましたが、所有 table を削除できません。remove を再実行してください' >&2
    return 1
  fi
  if ! systemctl daemon-reload; then
    printf '%s\n' 'host-preparation: boot guard は撤去しましたが systemd を再読込できません。remove を再実行してください' >&2
    return 1
  fi
  return 0
}
