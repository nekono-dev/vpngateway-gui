#!/bin/sh
# 責務: 所有 state とホスト上の実値を読み取り専用で照合して状態を表示する
# shellcheck disable=SC2154

hp_status_state_valid() {
  if [ -L "$hp_state_dir" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_state_dir" 2>/dev/null || :)" != directory ] ||
    [ "$(stat -c '%u:%g %a' "$hp_state_dir" 2>/dev/null || :)" != '0:0 700' ]; then
    printf '%s\n' 'host-preparation: state directory の所有状態が不正です' >&2
    return 1
  fi
  if [ -L "$hp_state_path" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_state_path" 2>/dev/null || :)" != 'regular file' ] ||
    [ "$(stat -c '%u:%g %a' "$hp_state_path" 2>/dev/null || :)" != '0:0 600' ]; then
    printf '%s\n' 'host-preparation: state が安全な通常ファイルではありません' >&2
    return 1
  fi
  hp_state_validate || return 1
}

hp_status_sysctl() {
  if ! grep -Fq '"sysctl":[' "$hp_state_path"; then return 0; fi
  hp_status_sysctl_failed=0
  for hp_status_key in $(hp_sysctl_owned_keys); do
    hp_status_original=$(hp_sysctl_original "$hp_status_key")
    hp_status_target=0
    [ "$hp_status_key" = net.ipv4.ip_forward ] && hp_status_target=1
    hp_status_current=$(hp_sysctl_current "$hp_status_key") || hp_status_current=
    if [ "$hp_status_current" = "$hp_status_target" ]; then
      printf 'active: sysctl %s=%s\n' "$hp_status_key" "$hp_status_current"
    elif [ "$hp_status_current" = "$hp_status_original" ]; then
      printf 'missing: sysctl %s (current=%s)\n' "$hp_status_key" "$hp_status_current"
      hp_status_sysctl_failed=1
    else
      printf 'foreign conflict: sysctl %s (current=%s, expected=%s)\n' "$hp_status_key" "${hp_status_current:-unknown}" "$hp_status_target"
      hp_status_sysctl_failed=1
    fi
  done
  hp_sysctl_iface=$(hp_boot_guard_recorded_iface)
  if [ -z "$hp_sysctl_iface" ]; then hp_sysctl_iface=$(hp_read_lan_iface "$hp_repo_root" 2>/dev/null || :); fi
  if [ -n "$hp_sysctl_iface" ]; then
    if [ -L "$hp_sysctl_config_path" ] ||
      [ "$(LC_ALL=C stat -c '%F' "$hp_sysctl_config_path" 2>/dev/null || :)" != 'regular file' ] ||
      [ "$(stat -c '%u:%g %a' "$hp_sysctl_config_path" 2>/dev/null || :)" != '0:0 600' ] ||
      ! cmp -s "$hp_sysctl_config_path" <<EOF
$(hp_sysctl_config_content)
EOF
    then
      printf '%s\n' 'drifted: sysctl configuration file'
      hp_status_sysctl_failed=1
    else
      printf '%s\n' 'active: sysctl configuration file'
    fi
  fi
  [ "$hp_status_sysctl_failed" -eq 0 ]
}

hp_status_boot_guard() {
  hp_status_iface=$(hp_boot_guard_recorded_iface)
  [ -n "$hp_status_iface" ] || return 0
  if [ "$(hp_boot_guard_recorded_status)" = absent ]; then
    printf '%s\n' 'absent: boot guard'
    return 0
  fi
  hp_status_failed=0
  hp_status_configured_iface=$(hp_read_lan_iface "$hp_repo_root" 2>/dev/null || :)
  if [ "$hp_status_configured_iface" != "$hp_status_iface" ]; then
    printf 'drifted: LAN_IFACE (.env=%s, state=%s)\n' "${hp_status_configured_iface:-unset}" "$hp_status_iface"
    hp_status_failed=1
  else
    printf 'active: LAN_IFACE=%s\n' "$hp_status_iface"
  fi
  if [ -L "$hp_boot_guard_unit_path" ] ||
    [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_unit_path" 2>/dev/null || :)" != 'regular file' ] ||
    [ "$(stat -c '%u:%g %a' "$hp_boot_guard_unit_path" 2>/dev/null || :)" != '0:0 644' ] ||
    ! cmp -s "$hp_boot_guard_unit_path" <<EOF
$(hp_boot_guard_unit_content)
EOF
  then
    printf '%s\n' 'drifted: boot guard unit'
    hp_status_failed=1
  elif ! hp_boot_guard_verify_docker_dependency || ! systemctl is-enabled "$hp_boot_guard_unit_name" >/dev/null 2>&1; then
    printf '%s\n' 'missing: boot guard unit enablement or Docker dependency'
    hp_status_failed=1
  else
    printf '%s\n' 'active: boot guard unit and Docker dependency'
  fi
  if [ -L "$hp_boot_guard_rules_path" ] ||
    [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != 'regular file' ] ||
    [ "$(stat -c '%u:%g %a' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != '0:0 600' ] ||
    ! cmp -s "$hp_boot_guard_rules_path" <<EOF
$(hp_boot_guard_apply_content "$hp_status_iface")
EOF
  then
    printf '%s\n' 'drifted: boot guard rules file'
    hp_status_failed=1
  elif ! hp_boot_guard_verify_resources || ! hp_boot_guard_verify_owned_table "$hp_status_iface"; then
    printf '%s\n' 'missing: boot guard nft table or chain'
    hp_status_failed=1
  else
    printf '%s\n' 'active: boot guard nft table and chain'
  fi
  [ "$hp_status_failed" -eq 0 ]
}

hp_status_host_reboot() {
  hp_host_reboot_status=$(hp_host_reboot_recorded_status)
  [ -n "$hp_host_reboot_status" ] || return 0
  hp_host_reboot_state_line=$(grep -F '"host_reboot"' "$hp_state_path" 2>/dev/null || :)
  hp_host_reboot_failed=0
  for hp_status_path in "$hp_host_ctl_dir" "$hp_host_reboot_exec_path" "$hp_host_reboot_path_unit_path" "$hp_host_reboot_service_unit_path" "$hp_host_reboot_enable_link_path" "$hp_host_reboot_spool_dir"; do
    case "$hp_host_reboot_state_line" in *"\"$hp_status_path\""*) ;; *) hp_host_reboot_failed=1 ;; esac
  done
  hp_status_identity=$(hp_host_reboot_recorded_directory_identity)
  if [ -L "$hp_host_ctl_dir" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_host_ctl_dir" 2>/dev/null || :)" != directory ] ||
    [ "$(stat -c '%u:%g %a' "$hp_host_ctl_dir" 2>/dev/null || :)" != '10001:10001 700' ] ||
    [ "$hp_status_identity" = missing ] || [ -z "$hp_status_identity" ] ||
    [ "$(stat -c '%d:%i' "$hp_host_ctl_dir" 2>/dev/null || :)" != "$hp_status_identity" ]; then
    hp_host_reboot_failed=1
  fi
  for hp_status_file in "$hp_host_reboot_exec_path:755:hp_host_reboot_exec_content" \
    "$hp_host_reboot_path_unit_path:644:hp_host_reboot_path_unit_content" \
    "$hp_host_reboot_service_unit_path:644:hp_host_reboot_service_unit_content"; do
    hp_status_old_ifs=$IFS
    IFS=:
    # shellcheck disable=SC2086
    set -- $hp_status_file
    IFS=$hp_status_old_ifs
    if [ -L "$1" ] || [ "$(LC_ALL=C stat -c '%F' "$1" 2>/dev/null || :)" != 'regular file' ] ||
      [ "$(stat -c '%u:%g %a' "$1" 2>/dev/null || :)" != "0:0 $2" ] || ! "$3" | cmp -s "$1" -; then
      hp_host_reboot_failed=1
    fi
  done
  if [ -L "$hp_host_reboot_enable_link_path" ] && hp_host_reboot_enable_link_owned &&
    [ "$(systemctl is-enabled "$hp_host_reboot_path_unit_name" 2>/dev/null || :)" = enabled ]; then
    :
  else
    hp_host_reboot_failed=1
  fi
  if [ -L "$hp_host_reboot_spool_dir" ] ||
    { [ -e "$hp_host_reboot_spool_dir" ] && [ "$(LC_ALL=C stat -c '%F' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" != directory ]; } ||
    { [ -e "$hp_host_reboot_spool_dir" ] && [ "$(stat -c '%u:%g %a' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" != '0:0 700' ]; }; then
    hp_host_reboot_failed=1
  fi
  if [ -e "$hp_host_ctl_dir/reboot-request" ] || [ -L "$hp_host_ctl_dir/reboot-request" ]; then
    if [ -L "$hp_host_ctl_dir/reboot-request" ] ||
      [ "$(LC_ALL=C stat -c '%F' "$hp_host_ctl_dir/reboot-request" 2>/dev/null || :)" != 'regular file' ] ||
      [ "$(stat -c '%u:%g %a' "$hp_host_ctl_dir/reboot-request" 2>/dev/null || :)" != '10001:10001 600' ] ||
      ! printf '%s\n' 'vpngwgui-host-reboot-v1' | cmp -s "$hp_host_ctl_dir/reboot-request" -; then hp_host_reboot_failed=1; fi
  fi
  for hp_status_entry in "$hp_host_ctl_dir"/* "$hp_host_ctl_dir"/.[!.]*; do
    [ -e "$hp_status_entry" ] || [ -L "$hp_status_entry" ] || continue
    [ "$hp_status_entry" = "$hp_host_ctl_dir/reboot-request" ] || hp_host_reboot_failed=1
  done
  if [ "$hp_host_reboot_failed" -eq 0 ]; then
    printf 'active: host reboot request path (%s)\n' "$hp_host_reboot_status"
    return 0
  fi
  printf 'drifted: host reboot request path (%s)\n' "$hp_host_reboot_status"
  return 1
}

hp_status() {
  if [ ! -e "$hp_state_path" ] && [ ! -L "$hp_state_path" ]; then
    printf '%s\n' 'host-preparation: 未適用（state がありません）'
    return 0
  fi
  hp_status_state_valid || return 1
  hp_status_any=0
  hp_status_failed=0
  if grep -Fq '"sysctl":[' "$hp_state_path"; then
    hp_status_any=1
    hp_status_sysctl || hp_status_failed=1
  fi
  if grep -Fq '"boot_guard"' "$hp_state_path"; then
    hp_status_any=1
    hp_status_boot_guard || hp_status_failed=1
  fi
  if grep -Fq '"host_reboot"' "$hp_state_path"; then
    hp_status_any=1
    hp_status_host_reboot || hp_status_failed=1
  fi
  if [ "$hp_status_any" -eq 0 ]; then printf '%s\n' 'host-preparation: state に所有対象がありません'; fi
  [ "$hp_status_failed" -eq 0 ]
}
