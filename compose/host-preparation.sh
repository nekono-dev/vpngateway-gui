#!/bin/sh
# 責務: ホスト準備 CLI の引数を検証し、各操作を dispatcher する
set -eu

script_path=$0
case "$script_path" in
  */*) script_path=${script_path%/*} ;;
  *) script_path=. ;;
esac
script_dir=$(CDPATH='' cd -- "$script_path" && pwd)
# shellcheck disable=SC1091
. "$script_dir/host-preparation/paths.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/common.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/state.sh"

usage() {
  printf '%s\n' 'Usage: host-preparation.sh {check|apply|status|remove}'
}

if [ "$#" -eq 1 ] && [ "$1" = --help ]; then usage; exit 0; fi
if [ "$#" -ne 1 ]; then
  usage >&2
  hp_error '操作は check、apply、status、remove のいずれか一つを指定してください。'
fi

case "$1" in
  check) hp_check_prerequisites ;;
  apply)
    hp_check_prerequisites || hp_error '前提条件を満たさないため apply を中止しました。'
    hp_state_initialize || hp_error '所有状態を初期化できないため apply を中止しました。'
    boot_guard_path=$script_dir/host-preparation/boot-guard.sh
    if [ -r "$boot_guard_path" ]; then
      # shellcheck disable=SC1090,SC1091
      . "$boot_guard_path"
      hp_apply_boot_guard || hp_error 'boot guard の適用または確認に失敗しました。環境はサポート対象外です。'
    else
      hp_error 'boot guard の適用処理が利用できません。環境はサポート対象外です。'
    fi
    ;;
  status|remove)
    handler="$script_dir/host-preparation/$1.sh"
    [ -r "$handler" ] || hp_error "$1 の所有状態処理が利用できません。"
    # shellcheck disable=SC1090
    . "$handler"
    "hp_$1"
    ;;
  *) usage >&2; hp_error "未対応の操作です: $1" ;;
esac
