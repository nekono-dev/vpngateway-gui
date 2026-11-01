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
# ランナーへ直接 status を送り、応答の形（ExecResult か）を記録する（API の 500 の切り分け用）
for v in protonvpn adguardvpn; do
  bin=/usr/bin/protonvpn
  [ "$v" = adguardvpn ] && bin=/usr/local/bin/adguardvpn-cli
  sudo docker exec "vpngwgui-runner-$v-1" node -e "
    const http = require('http');
    const body = JSON.stringify({ vendor: '$v', binary: '$bin', resolvedArgv: ['status'], timeoutMs: 15000 });
    const req = http.request({ socketPath: process.env.CTL_SOCKET_PATH, path: '/exec', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => console.log(res.statusCode, data));
    });
    req.on('error', (e) => console.log('error', e.message)); req.end(body);
  " > "$OUT/runner-exec-$v.txt" 2>&1 || true
done
