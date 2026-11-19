#!/bin/sh
# 責務: Docker の FORWARD drop を防ぐ daemon 設定を所有記録付きで管理する
# shellcheck disable=SC2154

hp_docker_forward_content() { printf '%s\n' '{"ip-forward-no-drop": true}'; }

hp_docker_forward_recorded_status() {
  sed -n \
    -e 's/.*"docker_forward":{"status":"pending"}.*/pending/p' \
    -e 's/.*"docker_forward":{"status":"applied"}.*/applied/p' \
    "$hp_state_path" 2>/dev/null || :
}

hp_docker_forward_record() {
  hp_df_status=$1
  [ -f "$hp_state_path" ] && [ ! -L "$hp_state_path" ] || return 1
  hp_df_tmp=$hp_state_dir/.state-docker-forward.$$.tmp
  (umask 077; set -C; : > "$hp_df_tmp") 2>/dev/null || return 1
  if grep -Fq '"docker_forward":{' "$hp_state_path"; then
    sed "s/\"docker_forward\":{\"status\":\"[a-z]*\"}/\"docker_forward\":{\"status\":\"$hp_df_status\"}/" "$hp_state_path" > "$hp_df_tmp" || { rm -f "$hp_df_tmp"; return 1; }
  else
    sed "s/}$/ ,\"docker_forward\":{\"status\":\"$hp_df_status\"}}/" "$hp_state_path" | sed 's/ ,/,/' > "$hp_df_tmp" || { rm -f "$hp_df_tmp"; return 1; }
  fi
  chmod 0600 "$hp_df_tmp" || { rm -f "$hp_df_tmp"; return 1; }
  mv -f "$hp_df_tmp" "$hp_state_path"
}

hp_docker_forward_file_state() {
  hp_df_recorded=$(hp_docker_forward_recorded_status)
  if [ -L "$hp_docker_daemon_config_path" ] || { [ -e "$hp_docker_daemon_config_path" ] && [ "$(LC_ALL=C stat -c '%F' "$hp_docker_daemon_config_path" 2>/dev/null || :)" != 'regular file' ]; }; then
    hp_df_file_state=CONFLICT
  elif [ ! -e "$hp_docker_daemon_config_path" ]; then
    if [ "$hp_df_recorded" = pending ]; then hp_df_file_state=PENDING-CLEANABLE; else hp_df_file_state=ABSENT; fi
  elif [ -n "$hp_df_recorded" ] && cmp -s "$hp_docker_daemon_config_path" <<EOF
$(hp_docker_forward_content)
EOF
  then
    hp_df_file_state=OWNED
  elif [ -n "$hp_df_recorded" ]; then
    hp_df_file_state=CONFLICT
  elif grep -Eq '"ip-forward-no-drop"[[:space:]]*:[[:space:]]*true([[:space:],}]|$)' "$hp_docker_daemon_config_path"; then
    hp_df_file_state=ALREADY-SET
  else
    hp_df_file_state=CONFLICT
  fi
}

hp_docker_forward_policy() {
  hp_df_policy=unknown
  if command -v iptables >/dev/null 2>&1; then
    hp_df_iptables=$(iptables -S FORWARD 2>/dev/null) || hp_df_iptables=
    case "$hp_df_iptables" in *"-P FORWARD DROP"*) hp_df_policy=DROP; return 0 ;; *"-P FORWARD ACCEPT"*) hp_df_policy=ACCEPT; return 0 ;; esac
  fi
  if command -v nft >/dev/null 2>&1; then
    hp_df_nft=$(nft list chain ip filter FORWARD 2>/dev/null) || hp_df_nft=
    case "$hp_df_nft" in *"policy drop"*) hp_df_policy=DROP ;; *"policy accept"*) hp_df_policy=ACCEPT ;; esac
  fi
}

hp_docker_forward_version() {
  hp_df_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null) || hp_df_version=
  hp_df_major=$(printf '%s\n' "$hp_df_version" | sed -n 's/^\([0-9][0-9]*\).*/\1/p')
}

hp_check_docker_forward() {
  hp_docker_forward_version
  if [ -z "$hp_df_major" ]; then printf '%s\n' 'Docker version: unknown'; hp_df_version_failed=1
  else printf 'Docker version: %s\n' "$hp_df_version"; hp_df_version_failed=0; fi
  if [ -z "$hp_df_major" ] || [ "$hp_df_major" -lt 28 ]; then
    printf '%s\n' '失敗: Docker 28 以降が必要です（ip-forward-no-drop に未対応の daemon は再起動できません）'
    hp_df_version_failed=1
  fi
  hp_docker_forward_file_state
  printf 'daemon.json: %s\n' "$hp_df_file_state"
  if [ "$hp_df_file_state" = CONFLICT ]; then
    printf '%s\n' '失敗: 既存の /etc/docker/daemon.json は変更しません。運用者が "ip-forward-no-drop": true を手動追加して Docker を再起動してください。'
  fi
  hp_docker_forward_policy
  printf 'FORWARD policy: %s\n' "$hp_df_policy"
  if [ "$hp_df_policy" = unknown ]; then
    printf '%s\n' '警告: FORWARD policy を確認できません。' >&2
  fi
  [ "$hp_df_version_failed" -eq 0 ] && [ "$hp_df_file_state" != CONFLICT ]
}

hp_docker_forward_restart() {
  printf '%s\n' '警告: Docker を再起動します。稼働中の他のコンテナも再起動されます。'
  systemctl restart docker || { printf '%s\n' 'host-preparation: Docker の再起動に失敗しました。'; return 1; }
  hp_df_wait=0
  while [ "$hp_df_wait" -lt 30 ]; do
    if systemctl is-active --quiet docker; then return 0; fi
    sleep 1
    hp_df_wait=$((hp_df_wait + 1))
  done
  printf '%s\n' 'host-preparation: Docker が30秒以内に active になりませんでした。'
  return 1
}

hp_apply_docker_forward() {
  hp_docker_forward_version
  if [ -z "$hp_df_major" ] || [ "$hp_df_major" -lt 28 ]; then
    printf '%s\n' 'host-preparation: Docker 28 以降が必要です。daemon.json は変更しません。' >&2
    return 1
  fi
  hp_docker_forward_file_state
  [ "$hp_df_file_state" != CONFLICT ] || { printf '%s\n' 'host-preparation: daemon.json は既存のため変更しません。"ip-forward-no-drop": true を手動追加し Docker を再起動してください。' >&2; return 1; }
  hp_docker_forward_policy
  if [ "$hp_df_policy" = unknown ]; then
    printf '%s\n' 'host-preparation: FORWARD policy を確認できません。daemon.json は変更していません。iptables/nftables の状態を確認してください。' >&2
    return 1
  fi
  hp_df_must_restart=0
  case "$hp_df_file_state" in
    ABSENT|PENDING-CLEANABLE) hp_df_must_restart=1 ;;
  esac
  if [ "$hp_df_file_state" = OWNED ] && [ "$(hp_docker_forward_recorded_status)" = pending ]; then
    hp_df_must_restart=1
  fi
  if [ "$hp_df_policy" = DROP ]; then hp_df_must_restart=1; fi
  if [ "$hp_df_policy" = ACCEPT ] && {
    { [ "$hp_df_file_state" = OWNED ] && [ "$(hp_docker_forward_recorded_status)" = applied ]; } ||
    [ "$hp_df_file_state" = ALREADY-SET ]
  }; then
    printf '%s\n' 'Docker forwarding 設定: 変更不要'
    return 0
  fi
  if [ "$hp_df_file_state" = ABSENT ] || [ "$hp_df_file_state" = PENDING-CLEANABLE ]; then
    hp_state_initialize || return 1
    hp_docker_forward_record pending || { printf '%s\n' 'host-preparation: Docker forwarding pending state を記録できません。' >&2; return 1; }
    hp_df_dir=${hp_docker_daemon_config_path%/*}
    if [ ! -d "$hp_df_dir" ] || [ -L "$hp_df_dir" ]; then
      printf '%s\n' 'host-preparation: /etc/docker が安全な directory ではありません。' >&2
      return 1
    fi
    hp_df_tmp=$hp_df_dir/.daemon.json.vpngwgui.$$.tmp
    if ! (umask 022; set -C; hp_docker_forward_content > "$hp_df_tmp") 2>/dev/null; then
      printf '%s\n' 'host-preparation: daemon.json 一時ファイルを作成できません。' >&2; return 1
    fi
    if ! chmod 0644 "$hp_df_tmp" || ! ln "$hp_df_tmp" "$hp_docker_daemon_config_path"; then
      rm -f "$hp_df_tmp"
      printf '%s\n' 'host-preparation: daemon.json を安全に配置できません。既存ファイルがあれば変更していません。' >&2
      return 1
    fi
    rm -f "$hp_df_tmp" || return 1
    hp_df_file_state=OWNED
  fi
  if [ "$hp_df_must_restart" -eq 1 ]; then
    hp_docker_forward_restart || return 1
    hp_docker_forward_policy
    if [ "$hp_df_policy" != ACCEPT ]; then
      printf 'host-preparation: Docker 再起動後の FORWARD policy が ACCEPT ではありません（%s）。ホストの iptables/nftables 設定を確認してください。\n' "$hp_df_policy" >&2
      return 1
    fi
  fi
  if [ "$hp_df_file_state" = OWNED ] || [ -n "$(hp_docker_forward_recorded_status)" ]; then
    hp_docker_forward_record applied || { printf '%s\n' 'host-preparation: Docker forwarding applied state を記録できません。' >&2; return 1; }
  fi
  printf '%s\n' 'Docker forwarding 設定: 適用済み'
}

hp_status_docker_forward() {
  hp_docker_forward_file_state
  hp_docker_forward_policy
  printf 'Docker daemon.json: %s\n' "$hp_df_file_state"
  printf 'Docker FORWARD policy: %s\n' "$hp_df_policy"
  [ "$hp_df_file_state" != CONFLICT ]
}

hp_docker_forward_preflight() {
  hp_docker_forward_file_state
  case "$hp_df_file_state" in
    OWNED) printf '%s\n' OWNED ;;
    ABSENT) printf '%s\n' ABSENT ;;
    PENDING-CLEANABLE) printf '%s\n' PENDING-CLEANABLE ;;
    *) printf '%s\n' 'CONFLICT: daemon.json differs from recorded ownership' ;;
  esac
}

hp_remove_docker_forward() {
  hp_docker_forward_file_state
  case "$hp_df_file_state" in
    OWNED) rm -f "$hp_docker_daemon_config_path" || return 1; printf '%s\n' 'daemon.json を削除しました。反映には Docker の再起動が必要です。' ;;
    ABSENT|PENDING-CLEANABLE) : ;;
    *) printf '%s\n' 'host-preparation: daemon.json が変更済みまたは外部所有のため削除しません。' >&2; return 1 ;;
  esac
}
