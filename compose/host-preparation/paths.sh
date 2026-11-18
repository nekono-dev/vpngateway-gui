#!/bin/sh
# 責務: host-preparation の固定された本番パスを定義する
# shellcheck disable=SC2034,SC2154

hp_os_release_path=/etc/os-release
hp_repo_root=$(CDPATH='' cd -- "$script_dir/.." && pwd)
hp_state_dir=/var/lib/vpngwgui-host-preparation
hp_sysctl_config_path=/etc/sysctl.d/99-vpngwgui-host-preparation.conf
hp_boot_guard_unit_path=/etc/systemd/system/vpngwgui-boot-guard.service
hp_boot_guard_docker_requires_path=/etc/systemd/system/docker.service.requires/vpngwgui-boot-guard.service
hp_boot_guard_rules_path=/etc/vpngwgui/boot-guard.nft
hp_host_ctl_dir=/var/lib/vpngwgui-host-ctl
hp_host_reboot_path_unit_path=/etc/systemd/system/vpngwgui-host-reboot.path
hp_host_reboot_service_unit_path=/etc/systemd/system/vpngwgui-host-reboot.service
hp_host_reboot_exec_path=/usr/local/libexec/vpngwgui-host-reboot
hp_host_reboot_enable_link_path=/etc/systemd/system/multi-user.target.wants/vpngwgui-host-reboot.path
hp_host_reboot_spool_dir=/var/lib/vpngwgui-host-reboot-spool
