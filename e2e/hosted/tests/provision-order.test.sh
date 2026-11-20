#!/bin/sh
# 責務: topology、host-preparation、Compose 起動と cleanup の順序を PATH fixture で検証する。

set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/../../.." && pwd)
cd "$ROOT"
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
PATH="$TEMP:$PATH"
export PATH
export EVENT_LOG="$TEMP/events.log"
cat > "$TEMP/docker" <<'DOCKER'
#!/bin/sh
printf 'docker %s\n' "$*" >> "$EVENT_LOG"
DOCKER
cat > "$TEMP/sudo" <<'SUDO'
#!/bin/sh
printf 'sudo %s\n' "$*" >> "$EVENT_LOG"
"$@"
SUDO
cat > "$TEMP/sh" <<'SH'
#!/bin/sh
printf 'sh %s LAN_IFACE=' "$*" >> "$EVENT_LOG"
awk -F= '/^[[:space:]]*LAN_IFACE[[:space:]]*=/{gsub(/[[:space:]\047\042]/, "", $2); print $2; exit}' .env >> "$EVENT_LOG"
SH
chmod +x "$TEMP/docker" "$TEMP/sudo" "$TEMP/sh"
if [ -f .env ]; then
  cp -p .env "$TEMP/original.env"
  ENV_ORIGINALLY_EXISTED=1
else
  ENV_ORIGINALLY_EXISTED=0
fi

E2E_WORK_DIR="$TEMP/work" export E2E_WORK_DIR
export E2E_BRIDGE=e2eseg E2E_WEB_PORT=18080 VPN_PROVIDERS=protonvpn,adguardvpn
export ROOT
/bin/sh -c '
  . e2e/hosted/lib/env.sh
  . e2e/hosted/lib/topology.sh
  . e2e/hosted/lib/provision.sh
  . e2e/hosted/lib/cleanup.sh
  topology_down() { printf "topology-down\\n" >> "$EVENT_LOG"; }
  topology_links() { printf "topology-links\\n" >> "$EVENT_LOG"; }
  topology_route_isp() { printf "topology-route\\n" >> "$EVENT_LOG"; }
  provision_certs() { printf "certs\\n" >> "$EVENT_LOG"; }
  provision_compose() { printf "compose-%s LAN_IFACE=%s\\n" "$1" "$LAN_IFACE" >> "$EVENT_LOG"; }
  provision_wait() { printf "wait\\n" >> "$EVENT_LOG"; }
  provision_group_prepare lifecycle
  hosted_cleanup
' 

event_line() { grep -n -F -x "$1" "$EVENT_LOG" | tail -n 1 | cut -d: -f1; }
links=$(event_line topology-links)
check=$(grep -n -F 'sh compose/host-preparation.sh check LAN_IFACE=e2eseg' "$EVENT_LOG" | tail -n 1 | cut -d: -f1)
apply=$(grep -n -F 'sh compose/host-preparation.sh apply LAN_IFACE=e2eseg' "$EVENT_LOG" | tail -n 1 | cut -d: -f1)
up=$(event_line 'compose-up LAN_IFACE=e2eseg')
down=$(grep -n -F 'docker compose -p vpngwgui -f docker-compose.yml -f vendors/protonvpn/compose.yml -f vendors/adguardvpn/compose.yml -f docker-compose.e2e-mock.yml down --remove-orphans' "$EVENT_LOG" | tail -n 1 | cut -d: -f1)
remove=$(grep -n -F 'sh compose/host-preparation.sh remove LAN_IFACE=e2eseg' "$EVENT_LOG" | tail -n 1 | cut -d: -f1)
topology=$(event_line topology-down)
[ "$links" -lt "$check" ] && [ "$check" -lt "$apply" ] && [ "$apply" -lt "$up" ]
[ "$up" -lt "$down" ] && [ "$down" -lt "$remove" ] && [ "$remove" -lt "$topology" ]
[ "$(grep -c '^sh compose/host-preparation.sh check LAN_IFACE=e2eseg$' "$EVENT_LOG")" -eq 1 ]
[ "$(grep -c '^sh compose/host-preparation.sh apply LAN_IFACE=e2eseg$' "$EVENT_LOG")" -eq 1 ]
if [ "$ENV_ORIGINALLY_EXISTED" -eq 1 ]; then cmp -s "$TEMP/original.env" .env; else [ ! -e .env ]; fi
