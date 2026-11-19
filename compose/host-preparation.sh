#!/bin/sh
# 責務: ホスト準備 CLI の引数を検証し、各操作を dispatcher する
set -eu

script_path=$0
case "$script_path" in */*) script_path=${script_path%/*} ;; *) script_path=. ;; esac
script_dir=$(CDPATH='' cd -- "$script_path" && pwd)
# shellcheck disable=SC1091
. "$script_dir/host-preparation/paths.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/common.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/state.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/docker-forward.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/docker-install.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/sysctl.sh"
# shellcheck disable=SC1091
. "$script_dir/host-preparation/host-reboot.sh"

usage() { printf '%s\n' '使用方法: host-preparation.sh {check|status|remove|apply [--yes]}'; }
if [ "$#" -eq 1 ] && [ "$1" = --help ]; then usage; exit 0; fi
command_name=${1-}
apply_yes=0
case "$command_name:$#" in
  check:1|status:1|remove:1|apply:1) ;;
  apply:2) [ "$2" = --yes ] || { usage >&2; exit 2; }; apply_yes=1 ;;
  *) usage >&2; exit 2 ;;
esac

hp_load_docker_os() {
  # hp_os_release_path は paths.sh で固定している。
  # shellcheck disable=SC2154
  hp_docker_os_id=$(sed -n 's/^ID=//p' "$hp_os_release_path" | tr -d '"')
  hp_docker_os_version=$(sed -n 's/^VERSION_ID=//p' "$hp_os_release_path" | tr -d '"')
  export hp_docker_os_id hp_docker_os_version
}

hp_report_docker() {
  hp_load_docker_os
  hp_cli_docker_action=$(hp_docker_assess) || hp_cli_docker_action=unsupported
  hp_cli_docker_source=未導入
  hp_cli_ce=$(hp_docker_package_status docker-ce 2>/dev/null || :)
  hp_cli_io=$(hp_docker_package_status docker.io 2>/dev/null || :)
  if [ -n "$hp_cli_ce" ]; then hp_cli_docker_source=Docker公式
  elif [ -n "$hp_cli_io" ]; then hp_cli_docker_source=OS標準
  elif [ "$hp_cli_docker_action" = unsupported ]; then hp_cli_docker_source=判定不能
  fi
  case "$hp_cli_docker_action" in
    ready)
      hp_cli_docker_version=$(hp_docker_engine_version 2>/dev/null || printf '%s' unknown)
      printf 'Docker: 配布元=%s Engine=%s Compose plugin=利用可能 apply 対処=なし\n' "$hp_cli_docker_source" "$hp_cli_docker_version"
      ;;
    install) printf '%s\n' 'Docker 未導入: 配布元=未導入 Engine=なし Compose plugin=未確認 apply 対処=Docker Engine と Compose plugin を同意のうえ導入' ;;
    upgrade)
      hp_cli_docker_version=$(hp_docker_engine_version 2>/dev/null || printf '%s' unknown)
      printf 'Docker: 配布元=%s Engine=%s Compose plugin=要確認 apply 対処=Docker 公式版を28以上へ更新\n' "$hp_cli_docker_source" "$hp_cli_docker_version"
      ;;
    compose)
      hp_cli_docker_version=$(hp_docker_engine_version 2>/dev/null || printf '%s' unknown)
      printf 'Docker: 配布元=%s Engine=%s Compose plugin=欠落 apply 対処=対応配布元から導入\n' "$hp_cli_docker_source" "$hp_cli_docker_version"
      ;;
    *) printf '%s\n' 'Docker: 配布元=判定不能 Engine=判定不能 Compose plugin=判定不能 apply 対処=自動処理不可' ;;
  esac
  return 0
}

case "$command_name" in
  check)
    hp_check_prerequisites || exit 1
    hp_load_docker_os
    docker_action=$(hp_docker_assess) || exit 1
    hp_report_docker
    case "$docker_action" in
      unsupported) printf '%s\n' 'NG: Docker の状態を自動解消できません' >&2; exit 1 ;;
      install|upgrade|compose|ready) printf 'OK: Docker action=%s\n' "$docker_action" ;;
    esac
    hp_check_host_reboot_accounts || exit 1
    if [ "$docker_action" = ready ]; then hp_check_docker_forward || exit 1; fi
    ;;
  apply)
    hp_check_prerequisites || hp_error '前提条件を満たさないため apply を中止しました。'
    hp_load_docker_os
    hp_docker_prepare "$apply_yes" || hp_error 'Docker の準備に失敗したため apply を中止しました。Docker 以外のホスト設定は変更していません。'
    docker_action=$(hp_docker_assess) || docker_action=unsupported
    [ "$docker_action" = ready ] || hp_error 'Docker の再検査に失敗しました。Docker 以外のホスト設定は変更していません。'
    hp_check_host_reboot_accounts || hp_error 'UID/GID 10001 が予約済みのため apply を中止しました。'
    hp_state_initialize || hp_error '所有状態を初期化できないため apply を中止しました。'
    hp_apply_sysctl || hp_error 'sysctl の適用に失敗しました。部分適用状態を確認してください。'
    boot_guard_path=$script_dir/host-preparation/boot-guard.sh
    if [ -r "$boot_guard_path" ]; then
      # shellcheck disable=SC1090,SC1091
      . "$boot_guard_path"
      hp_apply_boot_guard || hp_error 'boot guard の適用または確認に失敗しました。環境はサポート対象外です。'
    else hp_error 'boot guard の適用処理が利用できません。環境はサポート対象外です。'; fi
    hp_apply_host_reboot || hp_error 'host reboot の固定実行基盤を適用できませんでした。'
    hp_apply_docker_forward || hp_error 'Docker forwarding の適用に失敗しました。'
    ;;
  status|remove)
    # shellcheck disable=SC1091
    . "$script_dir/host-preparation/boot-guard.sh"
    # shellcheck disable=SC1091
    . "$script_dir/host-preparation/status.sh"
    handler="$script_dir/host-preparation/$command_name.sh"
    [ -r "$handler" ] || hp_error "$command_name の所有状態処理が利用できません。"
    # shellcheck disable=SC1090
    . "$handler"
    if [ "$command_name" = status ]; then
      hp_report_docker
      hp_status
    else
      if hp_remove; then hp_remove_result=0; else hp_remove_result=$?; fi
      printf '%s\n' 'Docker・Compose plugin・追加した配布元は残ります。必要なら手動で撤去してください'
      exit "$hp_remove_result"
    fi
    ;;
esac
