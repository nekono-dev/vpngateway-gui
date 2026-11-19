#!/bin/sh
# 責務: hosted E2E の中断・終了時に固定 Compose project と topology を安全に片付ける。

HOSTED_CLEANUP_RUNNING=0

# 目的: Compose、host-preparation、hosted .env、topology を順に片付ける。複数回呼んでも安全。
hosted_cleanup() {
  [ "$HOSTED_CLEANUP_RUNNING" -eq 1 ] && return 0
  HOSTED_CLEANUP_RUNNING=1
  docker compose -p vpngwgui -f docker-compose.yml \
    -f vendors/protonvpn/compose.yml -f vendors/adguardvpn/compose.yml \
    -f docker-compose.e2e-mock.yml down --remove-orphans >/dev/null 2>&1 || true
  sudo sh compose/host-preparation.sh remove >/dev/null 2>&1 || true
  if command -v provision_restore_host_env >/dev/null 2>&1; then provision_restore_host_env || true; fi
  topology_down || true
  HOSTED_CLEANUP_RUNNING=0
}

hosted_on_exit() {
  hosted_status=$?
  trap - EXIT
  hosted_cleanup
  exit "$hosted_status"
}

hosted_install_traps() {
  trap 'hosted_on_exit' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}
