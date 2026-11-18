#!/bin/sh
# 責務: ホスト準備の所有状態ファイルを root 専用権限で初期化する
# shellcheck disable=SC2154

hp_state_path=$hp_state_dir/state.json

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
    return 0
  fi
  attempt=0
  while [ "$attempt" -lt 10 ]; do
    attempt=$((attempt + 1))
    state_tmp=$hp_state_dir/.state.json.$$.${attempt}
    if (umask 077; set -C; printf '{"version":1,"owned":[]}\n' > "$state_tmp") 2>/dev/null; then
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
        return 0
      fi
    fi
  fi
  printf '%s\n' 'host-preparation: state を配置できません' >&2
  return 1
}
