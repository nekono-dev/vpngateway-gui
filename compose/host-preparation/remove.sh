#!/bin/sh
# 責務: 所有 handler を集約し、部分失敗を報告しながら安全な解除を進める
# shellcheck disable=SC2154

hp_sysctl_preflight() {
  hp_remove_sysctl_owned=0
  hp_remove_sysctl_any=0
  hp_sysctl_iface=
  for hp_remove_key in $(hp_sysctl_owned_keys); do
    hp_remove_original=$(hp_sysctl_original "$hp_remove_key")
    hp_remove_current=$(hp_sysctl_current "$hp_remove_key") || hp_remove_current=
    hp_remove_target=0
    [ "$hp_remove_key" = net.ipv4.ip_forward ] && hp_remove_target=1
    case "$hp_remove_key" in net.ipv4.conf.*.send_redirects) hp_sysctl_iface=${hp_remove_key#net.ipv4.conf.}; hp_sysctl_iface=${hp_sysctl_iface%.send_redirects} ;; esac
    if [ "$hp_remove_current" = "$hp_remove_target" ]; then
      hp_remove_sysctl_owned=1
    elif [ "$hp_remove_current" != "$hp_remove_original" ]; then
      printf 'CONFLICT: sysctl %s current=%s expected=%s or original=%s\n' "$hp_remove_key" "${hp_remove_current:-unknown}" "$hp_remove_target" "$hp_remove_original"
      return 0
    fi
  done
  if [ -L "$hp_sysctl_config_path" ]; then printf '%s\n' 'CONFLICT: sysctl config is a symlink'; return 0; fi
  if [ -e "$hp_sysctl_config_path" ]; then
    if [ "$(LC_ALL=C stat -c '%F' "$hp_sysctl_config_path" 2>/dev/null || :)" != 'regular file' ] ||
      [ "$(stat -c '%u:%g %a' "$hp_sysctl_config_path" 2>/dev/null || :)" != '0:0 600' ] ||
      ! cmp -s "$hp_sysctl_config_path" <<EOF
$(hp_sysctl_config_content)
EOF
    then printf '%s\n' 'CONFLICT: sysctl config differs from recorded product content'; return 0; fi
    hp_remove_sysctl_any=1
    hp_remove_sysctl_owned=1
  fi
  if [ "$hp_remove_sysctl_owned" -eq 1 ]; then printf '%s\n' OWNED
  elif [ "$hp_remove_sysctl_any" -eq 1 ]; then printf '%s\n' PENDING-CLEANABLE
  else printf '%s\n' ABSENT; fi
}

hp_host_reboot_preflight() {
  hp_host_reboot_precheck || { printf '%s\n' 'CONFLICT: host reboot object differs from recorded ownership'; return 0; }
  hp_remove_host_reboot_status=$(hp_host_reboot_recorded_status)
  if [ "$hp_remove_host_reboot_status" = applied ]; then printf '%s\n' OWNED
  elif [ -e "$hp_host_ctl_dir" ] || [ -L "$hp_host_ctl_dir" ] || [ -e "$hp_host_reboot_exec_path" ] || [ -e "$hp_host_reboot_path_unit_path" ] || [ -e "$hp_host_reboot_service_unit_path" ] || [ -e "$hp_host_reboot_enable_link_path" ] || [ -e "$hp_host_reboot_spool_dir" ]; then printf '%s\n' PENDING-CLEANABLE
  else printf '%s\n' ABSENT; fi
}

hp_boot_guard_preflight() {
  hp_remove_iface=$(hp_boot_guard_recorded_iface)
  [ -n "$hp_remove_iface" ] || { printf '%s\n' ABSENT; return 0; }
  hp_remove_guard_status=$(hp_boot_guard_recorded_status)
  if [ "$hp_remove_guard_status" = absent ]; then printf '%s\n' ABSENT; return 0; fi
  hp_remove_guard_any=0
  hp_remove_guard_owned=0
  if nft list table inet vpngwgui_guard >/dev/null 2>&1; then
    hp_remove_guard_any=1
    if ! hp_boot_guard_verify_resources ||
      { ! hp_boot_guard_verify_owned_table "$hp_remove_iface" &&
        { [ "$hp_remove_guard_status" != pending ] || [ -z "$(hp_boot_guard_previous_iface)" ] || ! hp_boot_guard_verify_owned_table "$(hp_boot_guard_previous_iface)"; }; }; then
      printf '%s\n' 'CONFLICT: guard table contains foreign or changed content'; return 0
    fi
    hp_remove_guard_owned=1
  fi
  hp_remove_guard_expected=$hp_state_dir/.boot-guard-preflight.$$.tmp
  if ! (umask 077; set -C; hp_boot_guard_unit_content > "$hp_remove_guard_expected") 2>/dev/null; then printf '%s\n' 'CONFLICT: cannot validate boot guard unit'; return 0; fi
  if [ -L "$hp_boot_guard_unit_path" ] || { [ -e "$hp_boot_guard_unit_path" ] &&
    { [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_unit_path" 2>/dev/null || :)" != 'regular file' ] ||
      [ "$(stat -c '%u:%g %a' "$hp_boot_guard_unit_path" 2>/dev/null || :)" != '0:0 644' ] || ! cmp -s "$hp_boot_guard_unit_path" "$hp_remove_guard_expected"; }; }; then
    rm -f "$hp_remove_guard_expected"; printf '%s\n' 'CONFLICT: boot guard unit differs from product content'; return 0
  fi
  if [ -e "$hp_boot_guard_unit_path" ]; then hp_remove_guard_any=1; hp_remove_guard_owned=1; fi
  rm -f "$hp_remove_guard_expected"
  hp_remove_requires_dir=${hp_boot_guard_docker_requires_path%/*}
  if [ -L "$hp_remove_requires_dir" ] || { [ -e "$hp_remove_requires_dir" ] && [ "$(LC_ALL=C stat -c '%F' "$hp_remove_requires_dir" 2>/dev/null || :)" != directory ]; }; then printf '%s\n' 'CONFLICT: Docker requires path is unsafe'; return 0; fi
  if [ -e "$hp_boot_guard_docker_requires_path" ] || [ -L "$hp_boot_guard_docker_requires_path" ]; then
    if [ ! -L "$hp_boot_guard_docker_requires_path" ] || [ "$(readlink "$hp_boot_guard_docker_requires_path" 2>/dev/null || :)" != "$hp_boot_guard_unit_path" ]; then printf '%s\n' 'CONFLICT: Docker dependency link is foreign'; return 0; fi
    hp_remove_guard_any=1; hp_remove_guard_owned=1
  fi
  if [ -e "$hp_boot_guard_rules_path" ] || [ -L "$hp_boot_guard_rules_path" ]; then
    if [ -L "$hp_boot_guard_rules_path" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != 'regular file' ] ||
      [ "$(stat -c '%u:%g %a' "$hp_boot_guard_rules_path" 2>/dev/null || :)" != '0:0 600' ] ||
      ! { hp_boot_guard_apply_content "$hp_remove_iface" | cmp -s "$hp_boot_guard_rules_path" - ||
        { [ "$hp_remove_guard_status" = pending ] && [ -n "$(hp_boot_guard_previous_iface)" ] && hp_boot_guard_apply_content "$(hp_boot_guard_previous_iface)" | cmp -s "$hp_boot_guard_rules_path" -; }; }; then printf '%s\n' 'CONFLICT: boot guard rules differ from product content'; return 0; fi
    hp_remove_guard_any=1; hp_remove_guard_owned=1
  fi
  if [ "$hp_remove_guard_owned" -eq 1 ]; then printf '%s\n' OWNED
  elif [ "$hp_remove_guard_any" -eq 1 ]; then printf '%s\n' PENDING-CLEANABLE
  else printf '%s\n' ABSENT; fi
}

hp_remove() {
  if [ ! -e "$hp_state_path" ] && [ ! -L "$hp_state_path" ]; then
    printf '%s\n' 'host-preparation: 解除対象の state がありません'
    return 0
  fi
  hp_status_state_valid || return 1
  hp_remove_preflight_failed=0
  if grep -Fq '"sysctl":[' "$hp_state_path"; then
    hp_remove_sysctl_class=$(hp_sysctl_preflight)
    case "$hp_remove_sysctl_class" in CONFLICT*) printf 'host-preparation: ownership conflict: sysctl (%s)\n' "$hp_remove_sysctl_class" >&2; hp_remove_preflight_failed=1 ;; OWNED|ABSENT|PENDING-CLEANABLE) ;; *) printf 'host-preparation: sysctl の解除前確認結果が不正です: %s\n' "$hp_remove_sysctl_class" >&2; hp_remove_preflight_failed=1 ;; esac
  fi
  if grep -Fq '"host_reboot":{' "$hp_state_path"; then
    hp_remove_host_reboot_class=$(hp_host_reboot_preflight)
    case "$hp_remove_host_reboot_class" in CONFLICT*) printf 'host-preparation: ownership conflict: host_reboot (%s)\n' "$hp_remove_host_reboot_class" >&2; hp_remove_preflight_failed=1 ;; OWNED|ABSENT|PENDING-CLEANABLE) ;; *) printf 'host-preparation: host_reboot の解除前確認結果が不正です: %s\n' "$hp_remove_host_reboot_class" >&2; hp_remove_preflight_failed=1 ;; esac
  fi
  if grep -Fq '"boot_guard":{' "$hp_state_path"; then
    hp_remove_boot_guard_class=$(hp_boot_guard_preflight)
    case "$hp_remove_boot_guard_class" in CONFLICT*) printf 'host-preparation: ownership conflict: boot_guard (%s)\n' "$hp_remove_boot_guard_class" >&2; hp_remove_preflight_failed=1 ;; OWNED|ABSENT|PENDING-CLEANABLE) ;; *) printf 'host-preparation: boot_guard の解除前確認結果が不正です: %s\n' "$hp_remove_boot_guard_class" >&2; hp_remove_preflight_failed=1 ;; esac
  fi
  if [ "$hp_remove_preflight_failed" -ne 0 ]; then
    printf '%s\n' 'host-preparation: 所有差分があるため変更を開始しませんでした' >&2
    return 1
  fi
  hp_remove_failed=0
  hp_remove_completed=
  hp_remove_stage() {
    hp_remove_name=$1
    hp_remove_function=$2
    hp_remove_class=$3
    printf '解除中: %s\n' "$hp_remove_name"
    if "$hp_remove_function"; then
      [ "$hp_remove_class" != ABSENT ] || printf 'already absent: %s\n' "$hp_remove_name"
      [ "$hp_remove_class" != PENDING-CLEANABLE ] || printf 'partial state cleaned: %s\n' "$hp_remove_name"
      if [ -n "$hp_remove_completed" ]; then hp_remove_completed="$hp_remove_completed, $hp_remove_name"; else hp_remove_completed=$hp_remove_name; fi
      printf '解除済み: %s\n' "$hp_remove_name"
    else
      printf 'host-preparation: 失敗段階: %s\n' "$hp_remove_name" >&2
      hp_remove_failed=1
    fi
  }
  if grep -Fq '"host_reboot"' "$hp_state_path"; then hp_remove_stage host_reboot hp_remove_host_reboot "$hp_remove_host_reboot_class"; fi
  if grep -Fq '"sysctl":[' "$hp_state_path"; then
    hp_sysctl_iface=$(hp_boot_guard_recorded_iface)
    if [ -z "$hp_sysctl_iface" ]; then hp_sysctl_iface=$(hp_read_lan_iface "$hp_repo_root" 2>/dev/null || :); fi
    hp_remove_stage sysctl hp_remove_sysctl "$hp_remove_sysctl_class"
  fi
  if grep -Fq '"boot_guard"' "$hp_state_path"; then hp_remove_stage boot_guard hp_remove_boot_guard "$hp_remove_boot_guard_class"; fi
  if [ "$hp_remove_failed" -ne 0 ]; then
    printf 'host-preparation: 解除済み変更: %s\n' "${hp_remove_completed:-なし}" >&2
    printf '%s\n' 'host-preparation: 未解除の所有 state を保持しました。remove を再実行してください。' >&2
    return 1
  fi
  if [ -L "$hp_state_path" ] || [ "$(LC_ALL=C stat -c '%F' "$hp_state_path" 2>/dev/null || :)" != 'regular file' ] ||
    [ "$(stat -c '%u:%g %a' "$hp_state_path" 2>/dev/null || :)" != '0:0 600' ]; then
    printf '%s\n' 'host-preparation: state が変更されたため保持します' >&2
    return 1
  fi
  rm -f "$hp_state_path" || { printf '%s\n' 'host-preparation: 完了 state を削除できません' >&2; return 1; }
  printf '解除済み変更: %s\n' "${hp_remove_completed:-なし}"
  printf '%s\n' 'host-preparation: Compose volume は変更していません'
}
