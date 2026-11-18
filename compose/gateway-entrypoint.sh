#!/bin/sh
# 責務: Gateway の共有 UDS volume を初期化し、UID/GID 10001 へ権限を降格して proxy を起動する。
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'gateway entrypoint must start as root' >&2
  exit 1
fi

gateway_socket_dir=/run/vpngw-gateway
if [ -L "$gateway_socket_dir" ] || [ ! -d "$gateway_socket_dir" ]; then
  printf '%s\n' 'gateway socket volume must be a real directory' >&2
  exit 1
fi

gateway_volume_state=$(stat -c '%u:%g %a' -- "$gateway_socket_dir")
case "$gateway_volume_state" in
  '0:0 '*|'10001:10001 '*) ;;
  *)
    printf '%s\n' 'gateway socket volume must be owned by root or UID/GID 10001' >&2
    exit 1
    ;;
esac

chown -h 10001:10001 "$gateway_socket_dir"
chmod 0700 "$gateway_socket_dir"
exec su-exec 10001:10001 node dist/server.js
