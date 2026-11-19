#!/bin/sh
# 責務: 展開済み bundle のホスト準備と Compose の読み取り専用前提を検査する。
set -eu

repo_root=${1:-/root/vpngwgui}
env_file=$repo_root/.env
created_env=false
cleanup_env() {
  if [ "$created_env" = true ]; then rm -f "$env_file"; fi
}
trap cleanup_env EXIT
trap 'exit 1' HUP INT TERM

if [ ! -e "$env_file" ] && [ ! -L "$env_file" ]; then
  # 受入時に実際の LAN_IFACE を選ぶため、静的 check 用に既存の lo を一時利用する。
  printf '%s\n' 'LAN_IFACE=lo' > "$env_file"
  created_env=true
fi

cd "$repo_root"
sh compose/host-preparation.sh check
docker compose -p vpngwgui config --quiet
