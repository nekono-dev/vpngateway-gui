#!/bin/sh
# 責務: 専用 ID の予約、root 依頼 directory、固定 reboot systemd 基盤を管理する
# state.json の host_reboot は status と directory/helper/unit/enable-link/spool の固定 path を記録する
# shellcheck disable=SC2154

hp_host_reboot_path_unit_name=vpngwgui-host-reboot.path
hp_host_reboot_service_unit_name=vpngwgui-host-reboot.service

hp_host_reboot_recorded_status() {
  sed -n 's/.*"host_reboot":{"status":"\(pending\|applied\)".*/\1/p' "$hp_state_path"
}

hp_host_reboot_recorded_directory_identity() {
  sed -n 's/.*"directory_identity":"\([0-9:]*\|missing\)".*/\1/p' "$hp_state_path"
}

# proxy と共有する一時名は .reboot-request.tmp.<digits>.<hex> のみを製品所有候補とする。
hp_host_reboot_is_cleanable_temp() {
  temp_path=$1
  temp_name=${temp_path##*/}
  case "$temp_name" in .reboot-request.tmp.*.*) ;; *) return 1 ;; esac
  temp_parts=${temp_name#.reboot-request.tmp.}
  temp_pid=${temp_parts%%.*}
  temp_hex=${temp_parts#*.}
  case "$temp_pid" in ''|*[!0-9]*) return 1 ;; esac
  case "$temp_hex" in ''|*[!0123456789abcdef]*) return 1 ;; esac
  [ "$temp_parts" != "$temp_hex" ] || return 1
  [ "${#temp_hex}" -eq 32 ] || return 1
  [ ! -L "$temp_path" ] && [ "$(LC_ALL=C stat -c '%F' "$temp_path" 2>/dev/null || :)" = 'regular file' ] || return 1
  [ "$(stat -c '%u:%g %a' "$temp_path" 2>/dev/null || :)" = '10001:10001 600' ] || return 1
  [ "$(stat -c '%s' "$temp_path" 2>/dev/null || echo 999999)" -le 256 ]
}

hp_host_reboot_enable_link_owned() {
  [ -L "$hp_host_reboot_enable_link_path" ] || return 1
  link_target=$(readlink "$hp_host_reboot_enable_link_path" 2>/dev/null || :)
  case "$link_target" in
    "$hp_host_reboot_path_unit_path"|../vpngwgui-host-reboot.path) return 0 ;;
    *) return 1 ;;
  esac
}

hp_host_reboot_state_record() {
  status=$1
  case "$status" in pending|applied) ;; *) return 1 ;; esac
  [ -f "$hp_state_path" ] && [ ! -L "$hp_state_path" ] || return 1
  [ "$(stat -c '%u:%g %a' "$hp_state_path" 2>/dev/null || :)" = '0:0 600' ] || return 1
  directory_identity=missing
  if [ -d "$hp_host_ctl_dir" ] && [ ! -L "$hp_host_ctl_dir" ]; then
    directory_identity=$(stat -c '%d:%i' "$hp_host_ctl_dir") || return 1
  fi
  state_tmp=$hp_state_dir/.state-host-reboot.$$.tmp
  if ! (umask 077; set -C; : > "$state_tmp") 2>/dev/null; then return 1; fi
  replacement="\"host_reboot\":{\"status\":\"$status\",\"directory\":\"$hp_host_ctl_dir\",\"directory_identity\":\"$directory_identity\",\"helper\":\"$hp_host_reboot_exec_path\",\"path_unit\":\"$hp_host_reboot_path_unit_path\",\"service_unit\":\"$hp_host_reboot_service_unit_path\",\"enable_link\":\"$hp_host_reboot_enable_link_path\",\"spool\":\"$hp_host_reboot_spool_dir\"}"
  if grep -Fq '"host_reboot"' "$hp_state_path"; then
    sed "s~\"host_reboot\":{[^}]*}~$replacement~" "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
  else
    sed "s~}\$~,$replacement}~" "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
  fi
  if [ "$(stat -c '%u:%g %a' "$state_tmp" 2>/dev/null || :)" != '0:0 600' ] || ! grep -Fq "$replacement" "$state_tmp"; then
    rm -f "$state_tmp"
    return 1
  fi
  mv -f "$state_tmp" "$hp_state_path"
}

hp_check_host_reboot_accounts() {
  if getent passwd 10001 >/dev/null 2>&1; then
    printf '%s\n' 'NG: UID 10001 は既存アカウントに使用されています' >&2
    return 1
  else
    lookup_status=$?
    if [ "$lookup_status" -ne 2 ]; then
      printf '%s\n' 'NG: UID 10001 の使用状況を確認できません' >&2
      return 1
    fi
  fi
  if getent group 10001 >/dev/null 2>&1; then
    printf '%s\n' 'NG: GID 10001 は既存グループに使用されています' >&2
    return 1
  else
    lookup_status=$?
    if [ "$lookup_status" -ne 2 ]; then
      printf '%s\n' 'NG: GID 10001 の使用状況を確認できません' >&2
      return 1
    fi
  fi
  printf '%s\n' 'OK: UID/GID 10001 は未使用です'
}

hp_host_reboot_path_unit_content() {
  cat <<EOF
[Unit]
Description=ホスト再起動依頼の監視

[Path]
PathExists=$hp_host_ctl_dir/reboot-request
Unit=$hp_host_reboot_service_unit_name

[Install]
WantedBy=multi-user.target
EOF
}

hp_host_reboot_service_unit_content() {
  cat <<EOF
[Unit]
Description=検証済みホスト再起動依頼の実行

[Service]
Type=oneshot
ExecStart=/bin/sh $hp_host_reboot_exec_path $hp_host_ctl_dir/reboot-request $hp_host_reboot_spool_dir
EOF
}

hp_host_reboot_exec_content() {
  cat <<'EOF'
#!/bin/sh
# 責務: 固定形式のホスト再起動依頼だけを一度消費して実行する
set -eu
[ "$#" -eq 2 ] || exit 1
request_file=$1
spool_dir=$2
attempt=0
while [ "$attempt" -lt 16 ]; do
  attempt=$((attempt + 1))
  consumed=$spool_dir/request.$$.${attempt}
  if [ -e "$consumed" ] || [ -L "$consumed" ]; then continue; fi
  if mv -- "$request_file" "$consumed" 2>/dev/null; then :; else
    [ -e "$request_file" ] || [ -L "$request_file" ] || exit 0
    continue
  fi
  [ -e "$consumed" ] || [ -L "$consumed" ] || exit 0
  reject=0
  if [ -L "$consumed" ] || [ "$(LC_ALL=C stat -c '%F' "$consumed" 2>/dev/null || :)" != 'regular file' ]; then
    reject=1
  elif [ "$(stat -c '%u:%g %a' "$consumed" 2>/dev/null || :)" != '10001:10001 600' ]; then
    reject=1
  elif ! printf '%s\n' 'vpngwgui-host-reboot-v1' | cmp -s - "$consumed"; then
    reject=1
  fi
  if [ "$reject" -eq 1 ]; then
    # spool は root-only で、消費済み entry は直下の request.* に限定する。
    case "$consumed" in "$spool_dir"/request.*) ;; *) exit 1 ;; esac
    if [ -e "$consumed" ] || [ -L "$consumed" ]; then
      [ ! -L "$consumed" ] || { rm -f -- "$consumed"; }
      if [ -e "$consumed" ] || [ -L "$consumed" ]; then
        if ! rm -rf --one-file-system -- "$consumed" 2>/dev/null; then
          rejected_dir=$spool_dir/rejected
          [ ! -L "$rejected_dir" ] || exit 1
          if [ ! -e "$rejected_dir" ]; then (umask 077; mkdir -- "$rejected_dir") || exit 1; fi
          [ -d "$rejected_dir" ] && [ ! -L "$rejected_dir" ] &&
            [ "$(stat -c '%u:%g %a' "$rejected_dir" 2>/dev/null || :)" = '0:0 700' ] || exit 1
          mv -- "$consumed" "$rejected_dir/request.$$-$attempt" || exit 1
        fi
      fi
    fi
  else
    rm -f -- "$consumed"
  fi
  if [ "$reject" -eq 1 ]; then
    printf '%s\n' 'host-preparation: 再起動依頼を拒否しました' >&2
    exit 1
  fi
  systemctl reboot
  exit $?
done
printf '%s\n' 'host-preparation: 再起動依頼を安全に消費できません' >&2
exit 1
EOF
}

hp_host_reboot_ensure_directory() {
  if [ -L "$hp_host_ctl_dir" ]; then
    printf '%s\n' 'host-preparation: host reboot directory が symlink です' >&2
    return 1
  fi
  if [ -e "$hp_host_ctl_dir" ]; then
    if [ "$(LC_ALL=C stat -c '%F' "$hp_host_ctl_dir" 2>/dev/null || :)" != directory ] ||
      [ "$(stat -c '%u:%g %a' "$hp_host_ctl_dir" 2>/dev/null || :)" != '10001:10001 700' ]; then
      printf '%s\n' 'host-preparation: host reboot directory の owner/mode が不正です' >&2
      return 1
    fi
    return 0
  fi
  (umask 077; mkdir "$hp_host_ctl_dir") || {
    printf '%s\n' 'host-preparation: host reboot directory を作成できません' >&2
    return 1
  }
  if ! chown 10001:10001 "$hp_host_ctl_dir" || ! chmod 0700 "$hp_host_ctl_dir" ||
    [ "$(stat -c '%u:%g %a' "$hp_host_ctl_dir" 2>/dev/null || :)" != '10001:10001 700' ]; then
    printf '%s\n' 'host-preparation: host reboot directory を安全な owner/mode に設定できません' >&2
    return 1
  fi
}

hp_host_reboot_install_file() {
  destination=$1
  mode=$2
  content_function=$3
  directory=${destination%/*}
  if [ -L "$directory" ] || [ "$(LC_ALL=C stat -c '%F' "$directory" 2>/dev/null || :)" != directory ] ||
    [ "$(stat -c '%u:%g %a' "$directory" 2>/dev/null || :)" != '0:0 755' ]; then
    printf 'host-preparation: systemd directory が安全ではありません: %s\n' "$directory" >&2
    return 1
  fi
  if [ -L "$destination" ]; then
    printf 'host-preparation: host reboot file が symlink です: %s\n' "$destination" >&2
    return 1
  fi
  existing_kind=$(LC_ALL=C stat -c '%F' "$destination" 2>/dev/null || :)
  if [ -n "$existing_kind" ]; then
    expected=$directory/.vpngwgui-host-reboot-expected.$$.tmp
    if ! (umask 077; set -C; "$content_function" > "$expected") 2>/dev/null; then return 1; fi
    if [ "$existing_kind" = 'regular file' ] &&
      [ "$(stat -c '%u:%g %a' "$destination" 2>/dev/null || :)" = "0:0 $mode" ] && cmp -s "$destination" "$expected"; then
      rm -f "$expected"
      return 0
    fi
    rm -f "$expected"
    printf 'host-preparation: host reboot file に所有権競合があります: %s\n' "$destination" >&2
    return 1
  fi
  temporary_file=$directory/.vpngwgui-host-reboot.$$.tmp
  if ! (umask 077; set -C; "$content_function" > "$temporary_file") 2>/dev/null; then
    printf 'host-preparation: host reboot 一時ファイルを作成できません: %s\n' "$destination" >&2
    return 1
  fi
  if [ -L "$temporary_file" ] || [ "$(LC_ALL=C stat -c '%F' "$temporary_file" 2>/dev/null || :)" != 'regular file' ] ||
    ! chmod "$mode" "$temporary_file" || ! chown root:root "$temporary_file" ||
    [ "$(stat -c '%u:%g %a' "$temporary_file" 2>/dev/null || :)" != "0:0 $mode" ] || ! ln "$temporary_file" "$destination" 2>/dev/null; then
    rm -f "$temporary_file"
    printf 'host-preparation: host reboot file を安全に配置できません: %s\n' "$destination" >&2
    return 1
  fi
  rm -f "$temporary_file"
}

hp_host_reboot_ensure_exec_directory() {
  directory=${hp_host_reboot_exec_path%/*}
  if [ -L "$directory" ]; then
    printf '%s\n' 'host-preparation: host reboot 実行 directory が symlink です' >&2
    return 1
  fi
  if [ -e "$directory" ]; then
    if [ "$(LC_ALL=C stat -c '%F' "$directory" 2>/dev/null || :)" != directory ] ||
      [ "$(stat -c '%u:%g %a' "$directory" 2>/dev/null || :)" != '0:0 755' ]; then
      printf '%s\n' 'host-preparation: host reboot 実行 directory の owner/mode が不正です' >&2
      return 1
    fi
    return 0
  fi
  (umask 022; mkdir "$directory") || return 1
  if ! chown root:root "$directory" || ! chmod 0755 "$directory" ||
    [ "$(stat -c '%u:%g %a' "$directory" 2>/dev/null || :)" != '0:0 755' ]; then
    printf '%s\n' 'host-preparation: host reboot 実行 directory を安全に作成できません' >&2
    return 1
  fi
}

hp_host_reboot_ensure_spool() {
  if [ -L "$hp_host_reboot_spool_dir" ]; then return 1; fi
  if [ ! -e "$hp_host_reboot_spool_dir" ]; then (umask 077; mkdir "$hp_host_reboot_spool_dir") || return 1; fi
  [ "$(LC_ALL=C stat -c '%F' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" = directory ] &&
    [ "$(stat -c '%u:%g %a' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" = '0:0 700' ] &&
    [ "$(stat -c '%d' "$hp_host_ctl_dir" 2>/dev/null || :)" = "$(stat -c '%d' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" ]
}

hp_host_reboot_check_file() {
  path=$1
  mode=$2
  content_function=$3
  if [ -L "$path" ]; then return 1; fi
  kind=$(LC_ALL=C stat -c '%F' "$path" 2>/dev/null || :)
  [ -n "$kind" ] || return 0
  [ "$kind" = 'regular file' ] || return 1
  expected=$hp_state_dir/.host-reboot-check.$$.tmp
  (umask 077; set -C; "$content_function" > "$expected") 2>/dev/null || return 1
  result=1
  if [ "$(stat -c '%u:%g %a' "$path" 2>/dev/null || :)" = "0:0 $mode" ] && cmp -s "$path" "$expected"; then result=0; fi
  rm -f "$expected"
  return "$result"
}

hp_host_reboot_precheck() {
  recorded=$(hp_host_reboot_recorded_status)
  if grep -Fq '"host_reboot"' "$hp_state_path" && [ -z "$recorded" ]; then return 1; fi
  for file in "$hp_host_reboot_exec_path:755:hp_host_reboot_exec_content" \
    "$hp_host_reboot_path_unit_path:644:hp_host_reboot_path_unit_content" \
    "$hp_host_reboot_service_unit_path:644:hp_host_reboot_service_unit_content"; do
    old_ifs=$IFS
    IFS=:
    # shellcheck disable=SC2086
    set -- $file
    IFS=$old_ifs
    hp_host_reboot_check_file "$1" "$2" "$3" || {
      [ "$recorded" = pending ] || return 1
      # pending でも、記録済み対象の差し替えは受け入れない。
      return 1
    }
    if { [ -e "$1" ] || [ -L "$1" ]; } && [ -z "$recorded" ]; then return 1; fi
  done
  if [ -e "$hp_host_ctl_dir" ] || [ -L "$hp_host_ctl_dir" ]; then
    [ ! -L "$hp_host_ctl_dir" ] && [ "$(LC_ALL=C stat -c '%F' "$hp_host_ctl_dir" 2>/dev/null || :)" = directory ] &&
      [ "$(stat -c '%u:%g %a' "$hp_host_ctl_dir" 2>/dev/null || :)" = '10001:10001 700' ] || return 1
    [ -n "$recorded" ] || return 1
    recorded_identity=$(hp_host_reboot_recorded_directory_identity)
    current_identity=$(stat -c '%d:%i' "$hp_host_ctl_dir" 2>/dev/null || :)
    if [ -n "$recorded_identity" ] && [ "$recorded_identity" != missing ] && [ "$recorded_identity" != "$current_identity" ]; then return 1; fi
    for entry in "$hp_host_ctl_dir"/* "$hp_host_ctl_dir"/.[!.]*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      if [ "$entry" != "$hp_host_ctl_dir/reboot-request" ]; then hp_host_reboot_is_cleanable_temp "$entry" || return 1; fi
    done
  fi
  if [ -e "$hp_host_reboot_spool_dir" ] || [ -L "$hp_host_reboot_spool_dir" ]; then
    [ ! -L "$hp_host_reboot_spool_dir" ] && [ "$(LC_ALL=C stat -c '%F' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" = directory ] &&
      [ "$(stat -c '%u:%g %a' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" = '0:0 700' ] &&
      [ "$(stat -c '%d' "$hp_host_ctl_dir" 2>/dev/null || :)" = "$(stat -c '%d' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" ] || return 1
    [ -n "$recorded" ] || return 1
  fi
  link_directory=${hp_host_reboot_enable_link_path%/*}
  if [ -L "$link_directory" ] || { [ -e "$link_directory" ] && [ "$(LC_ALL=C stat -c '%F' "$link_directory" 2>/dev/null || :)" != directory ]; }; then return 1; fi
  if [ -e "$hp_host_reboot_enable_link_path" ] || [ -L "$hp_host_reboot_enable_link_path" ]; then
    hp_host_reboot_enable_link_owned || return 1
    [ -n "$recorded" ] || return 1
  fi
  return 0
}

hp_remove_host_reboot() {
  if [ ! -f "$hp_state_path" ] || [ -L "$hp_state_path" ] ||
    [ "$(stat -c '%u:%g %a' "$hp_state_path" 2>/dev/null || :)" != '0:0 600' ]; then
      printf '%s\n' 'host-preparation: host reboot 所有 state がありません' >&2
      return 1
  fi
  recorded=$(hp_host_reboot_recorded_status)
  [ -n "$recorded" ] || return 0
  state_line=$(grep -F '"host_reboot"' "$hp_state_path")
  for path in "$hp_host_ctl_dir" "$hp_host_reboot_exec_path" "$hp_host_reboot_path_unit_path" "$hp_host_reboot_service_unit_path" "$hp_host_reboot_enable_link_path" "$hp_host_reboot_spool_dir"; do
    case "$state_line" in *"\"$path\""*) ;; *) printf '%s\n' 'host-preparation: host reboot state の path が一致しません' >&2; return 1 ;; esac
  done
  recorded_identity=$(hp_host_reboot_recorded_directory_identity)
  if [ -e "$hp_host_ctl_dir" ] || [ -L "$hp_host_ctl_dir" ]; then
    current_identity=$(stat -c '%d:%i' "$hp_host_ctl_dir" 2>/dev/null || :)
    [ -n "$recorded_identity" ] && [ "$recorded_identity" != missing ] && [ "$recorded_identity" = "$current_identity" ] || return 1
  elif [ "$recorded_identity" != missing ]; then
    return 1
  fi
  hp_host_reboot_check_file "$hp_host_reboot_exec_path" 755 hp_host_reboot_exec_content || return 1
  hp_host_reboot_check_file "$hp_host_reboot_path_unit_path" 644 hp_host_reboot_path_unit_content || return 1
  hp_host_reboot_check_file "$hp_host_reboot_service_unit_path" 644 hp_host_reboot_service_unit_content || return 1
  if [ -e "$hp_host_ctl_dir" ] || [ -L "$hp_host_ctl_dir" ]; then
    [ ! -L "$hp_host_ctl_dir" ] && [ "$(LC_ALL=C stat -c '%F' "$hp_host_ctl_dir" 2>/dev/null || :)" = directory ] &&
      [ "$(stat -c '%u:%g %a' "$hp_host_ctl_dir" 2>/dev/null || :)" = '10001:10001 700' ] || return 1
    for entry in "$hp_host_ctl_dir"/* "$hp_host_ctl_dir"/.[!.]*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      if [ "$entry" != "$hp_host_ctl_dir/reboot-request" ]; then
        hp_host_reboot_is_cleanable_temp "$entry" || { printf '%s\n' 'host-preparation: host reboot directory に未知の項目があります' >&2; return 1; }
      fi
    done
  fi
  if [ -e "$hp_host_reboot_spool_dir" ] || [ -L "$hp_host_reboot_spool_dir" ]; then
    [ ! -L "$hp_host_reboot_spool_dir" ] && [ "$(LC_ALL=C stat -c '%F' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" = directory ] &&
      [ "$(stat -c '%u:%g %a' "$hp_host_reboot_spool_dir" 2>/dev/null || :)" = '0:0 700' ] || return 1
    for entry in "$hp_host_reboot_spool_dir"/* "$hp_host_reboot_spool_dir"/.[!.]* "$hp_host_reboot_spool_dir"/..?*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      # root-only spool は製品所有。残った entry は remove で安全に掃除する。
      case "$entry" in "$hp_host_reboot_spool_dir"/*) ;; *) return 1 ;; esac
    done
  fi
  if [ -e "$hp_host_reboot_enable_link_path" ] || [ -L "$hp_host_reboot_enable_link_path" ]; then
    hp_host_reboot_enable_link_owned || return 1
  fi
  # 全所有確認後に監視を止め、依頼を残したまま path trigger できない状態にする。
  if [ -e "$hp_host_reboot_path_unit_path" ] || [ -L "$hp_host_reboot_enable_link_path" ]; then
    systemctl disable --now "$hp_host_reboot_path_unit_name" >/dev/null 2>&1 || return 1
  fi
  [ ! -L "$hp_host_reboot_enable_link_path" ] || rm -f "$hp_host_reboot_enable_link_path" || return 1
  [ ! -e "$hp_host_ctl_dir/reboot-request" ] && [ ! -L "$hp_host_ctl_dir/reboot-request" ] || rm -f "$hp_host_ctl_dir/reboot-request" || return 1
  for entry in "$hp_host_ctl_dir"/.reboot-request.tmp.*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    hp_host_reboot_is_cleanable_temp "$entry" || return 1
    rm -f -- "$entry" || return 1
  done
  for entry in "$hp_host_reboot_spool_dir"/* "$hp_host_reboot_spool_dir"/.[!.]* "$hp_host_reboot_spool_dir"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case "$entry" in "$hp_host_reboot_spool_dir"/*) ;; *) return 1 ;; esac
    [ ! -L "$entry" ] || { rm -f -- "$entry" || return 1; }
    if [ -e "$entry" ] || [ -L "$entry" ]; then
      rm -rf --one-file-system -- "$entry" || return 1
    fi
  done
  [ ! -e "$hp_host_reboot_exec_path" ] || rm -f "$hp_host_reboot_exec_path" || return 1
  [ ! -e "$hp_host_reboot_path_unit_path" ] || rm -f "$hp_host_reboot_path_unit_path" || return 1
  [ ! -e "$hp_host_reboot_service_unit_path" ] || rm -f "$hp_host_reboot_service_unit_path" || return 1
  [ ! -e "$hp_host_ctl_dir" ] || rmdir "$hp_host_ctl_dir" || return 1
  [ ! -e "$hp_host_reboot_spool_dir" ] || rmdir "$hp_host_reboot_spool_dir" || return 1
  systemctl daemon-reload || return 1
  state_tmp=$hp_state_dir/.state-host-reboot-remove.$$.tmp
  (umask 077; set -C; : > "$state_tmp") 2>/dev/null || return 1
  sed 's/,"host_reboot":{[^}]*}/}/' "$hp_state_path" > "$state_tmp" || { rm -f "$state_tmp"; return 1; }
  mv -f "$state_tmp" "$hp_state_path"
}

hp_apply_host_reboot() {
  hp_check_host_reboot_accounts || return 1
  hp_state_initialize || return 1
  hp_host_reboot_precheck || { printf '%s\n' 'host-preparation: host reboot 既存物に所有権競合があります' >&2; return 1; }
  hp_host_reboot_state_record pending || return 1
  hp_host_reboot_ensure_directory || return 1
  hp_host_reboot_state_record pending || return 1
  hp_host_reboot_ensure_exec_directory || return 1
  hp_host_reboot_ensure_spool || return 1
  hp_host_reboot_install_file "$hp_host_reboot_exec_path" 755 hp_host_reboot_exec_content || return 1
  hp_host_reboot_install_file "$hp_host_reboot_service_unit_path" 644 hp_host_reboot_service_unit_content || return 1
  hp_host_reboot_install_file "$hp_host_reboot_path_unit_path" 644 hp_host_reboot_path_unit_content || return 1
  if ! systemctl daemon-reload || ! systemctl enable --now "$hp_host_reboot_path_unit_name" ||
    [ "$(systemctl is-enabled "$hp_host_reboot_path_unit_name" 2>/dev/null || :)" != enabled ]; then
    printf '%s\n' 'host-preparation: host reboot path unit を有効化・確認できません' >&2
    return 1
  fi
  if ! hp_host_reboot_enable_link_owned; then
    printf '%s\n' 'host-preparation: host reboot enable link を確認できません' >&2
    return 1
  fi
  hp_host_reboot_state_record applied || return 1
  printf '%s\n' 'host-preparation: 固定 reboot request 基盤を適用しました'
}
