#!/bin/sh
# 責務: host-preparation の固定された本番パスを定義する
# shellcheck disable=SC2034,SC2154

hp_os_release_path=/etc/os-release
hp_repo_root=$(CDPATH='' cd -- "$script_dir/.." && pwd)
hp_state_dir=/var/lib/vpngwgui-host-preparation
hp_sysctl_config_path=/etc/sysctl.d/99-vpngwgui-host-preparation.conf
