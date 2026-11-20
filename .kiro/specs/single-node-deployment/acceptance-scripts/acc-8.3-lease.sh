#!/usr/bin/env bash
# 8.3 期限付き set の測定: proxy を一時停止した区間で、製品と同じ batch（guard-ruleset.ts の flush set + add element）で
# 4 秒の lease を追加・2 秒後に更新し、250ms ごとに観測して更新から約 4 秒で自然失効することを確かめる。
# cwd はリポジトリルート（e2e/hosted/lib/env.sh の LAN_IFACE を使う）。root で実行する。
set -uo pipefail
. e2e/hosted/lib/env.sh
LAN_IFACE=${LAN_IFACE:-e2eseg}
PROXY=$(docker compose -p vpngwgui ps -q proxy | head -n1)
stamp() { date -u '+%Y-%m-%dT%H:%M:%S.%3NZ'; }
refresh() { printf 'flush set inet vpngwgui_guard healthy_lease4\nadd element inet vpngwgui_guard healthy_lease4 { "%s" timeout 4s }\n' "$LAN_IFACE" | nft -f -; }
trap 'docker unpause "$PROXY" >/dev/null 2>&1 || true' EXIT
docker pause "$PROXY" >/dev/null || exit 1
echo "proxy 一時停止 $(stamp)"
refresh || exit 1; added=$(date +%s%3N); echo "追加 $(stamp)"; nft list set inet vpngwgui_guard healthy_lease4
sleep 2
refresh || exit 1; updated=$(date +%s%3N); echo "更新 $(stamp)（追加から $(( updated - added ))ms）"; nft list set inet vpngwgui_guard healthy_lease4
end=$(( updated + 6500 )); expired=0
while (( $(date +%s%3N) < end )); do
  now=$(date +%s%3N)
  if ! nft list set inet vpngwgui_guard healthy_lease4 | grep -q 'elements = {'; then
    expired=$now; echo "自然失効観測 $(stamp) 更新から $(( now - updated ))ms・追加から $(( now - added ))ms"; nft list set inet vpngwgui_guard healthy_lease4; break
  fi
  sleep 0.25
done
docker unpause "$PROXY" >/dev/null; echo "proxy 再開 $(stamp)"
if (( expired > 0 && expired - updated >= 3500 && expired - updated <= 5000 )); then echo "判定: PASS"; else echo "判定: FAIL"; exit 1; fi
