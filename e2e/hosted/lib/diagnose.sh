#!/bin/sh
# 責務: 失敗時の診断を集める（経路・nftables・compose のログ）。e2e/artifacts/hosted/<group>/diag/ へ保存する（要件 1.4・1.5）。
# 秘密（資格情報・Cookie）を含みうるログは保存しない（compose のログは API・ランナーの出力のみ。環境変数は出さない）。
# 使い方: sh diagnose.sh <group>

set -u
GROUP="${1:?群の名前を指定する}"
OUT="e2e/artifacts/hosted/$GROUP/diag"
mkdir -p "$OUT"
{ ip -4 route show; echo '--- rule'; ip rule show; echo '--- table 100'; ip route show table 100; } > "$OUT/route.txt" 2>&1
sudo nft list ruleset > "$OUT/nft.txt" 2>&1 || true
sudo docker compose --project-directory /opt/vpngwgui ps > "$OUT/compose-ps.txt" 2>&1 || true
sudo docker compose --project-directory /opt/vpngwgui logs --no-color --tail 300 > "$OUT/compose-logs.txt" 2>&1 || true
sudo systemctl list-units 'vpngwgui*' --no-pager > "$OUT/units.txt" 2>&1 || true
exit 0
