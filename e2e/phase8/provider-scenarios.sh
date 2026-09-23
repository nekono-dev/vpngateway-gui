#!/bin/bash
# 責務: Phase 8完了基準（wbs/phase8.md）のうち、Web UIからのベンダー選択・接続中の切替（確認→自動切断）・ベンダー別状態の独立・
#       ランナーの利用可否・ランナーの許可バイナリ・ネットワークコンテナへのCLI非同梱を、AdGuard VPN（ランナーは同梱・未ログイン）と
#       モックProton VPNの2ベンダーで検証する（開発ホストのdocker compose。実VPN不要）。
# 実行: bash e2e/phase8/provider-scenarios.sh
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
BASE=${BASE:-http://localhost:18080}
PROJECT=vpngwgui-e2e-mock
. "$HERE/../lib/e2e-vendors.sh"
. "$HERE/../lib/api-auth.sh"
make_e2e_vendors_dir adguardvpn mockproton
# 相対パスのcomposeファイル（本体の位置が基準）を使うため、リポジトリルートで実行する。
cd "$ROOT" || exit 1
DC="docker compose -p $PROJECT $(e2e_compose_files adguardvpn mockproton)"
FAILS=0
gui() { node "$HERE/webgui-providers.mjs" "$BASE" "$@" || FAILS=$((FAILS+1)); }
check() { # check <説明> <条件が真のときexit 0となるコマンド...>
  local desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS+1)); fi
}
# down -vでvolumeごと消えるため、Web UI利用者アカウント（operator-account.json）はreset_operator_account不要。
cleanup() { $DC down -v >/dev/null 2>&1; rm -rf "$E2E_VENDORS_DIR"; e2e_api_cleanup; }
trap cleanup EXIT

# ランナーのUDSへ、任意のバイナリの実行要求を直接送り、HTTPステータスを返す（ランナーの許可バイナリの確認用）。
runner_exec_status() { # runner_exec_status <service> <socket> <binary>
  $DC exec -T "$1" node -e '
    const http = require("node:http");
    const req = http.request({ socketPath: process.argv[1], path: "/exec", method: "POST" }, (res) => { console.log(res.statusCode); res.resume(); });
    req.end(JSON.stringify({ vendor: "x", binary: process.argv[2], resolvedArgv: ["-c", "echo pwned"], timeoutMs: 3000 }));
  ' "$2" "$3"
}
mock_status() { $DC exec -T runner-mockproton /usr/local/bin/protonvpn-mock status 2>/dev/null; }

echo "== 準備: 2ベンダー（AdGuard VPN・モックProton VPN）構成の起動（ビルドを含む）"
$DC up -d --build >/dev/null 2>&1 || { echo "FAIL: 起動に失敗"; exit 1; }
for _ in $(seq 1 60); do curl -sf "$BASE/api/v1/operator" >/dev/null 2>&1 && break; sleep 1; done
e2e_api_login "$BASE"
for _ in $(seq 1 60); do curl -sf -b "$E2E_COOKIE_JAR" "$BASE/api/v1/providers" 2>/dev/null | grep -q mockproton && break; sleep 1; done

echo "== initial: 選択部品・選択中・利用可否"
gui initial
echo "== switch-idle: 切断中の切替（確認なし）・画面の入れ替え・サーバ側での保持"
gui switch-idle
echo "== mock-login-connect: モックへログインして自動接続"
gui mock-login-connect
check "モックCLIが接続中" bash -c "$(declare -f mock_status); DC='$DC'; $DC exec -T runner-mockproton /usr/local/bin/protonvpn-mock status | grep -q 'Status: Connected'"
echo "== switch-decline: 接続中の切替で確認を拒否"
gui switch-decline
check "拒否後もモックCLIは接続中のまま" bash -c "$DC exec -T runner-mockproton /usr/local/bin/protonvpn-mock status | grep -q 'Status: Connected'"
echo "== switch-accept: 接続中の切替で確認を承諾（現在のVPNを自動で切断）"
gui switch-accept
check "承諾後、モックCLIが切断されている（自動切断）" bash -c "$DC exec -T runner-mockproton /usr/local/bin/protonvpn-mock status | grep -q 'Status: Disconnected'"
check "APIの選択中がadguardvpn" bash -c "curl -s -b \"\$E2E_COOKIE_JAR\" $BASE/api/v1/providers | grep -q '\"id\":\"adguardvpn\",\"displayName\":\"AdGuard VPN\",\"active\":true'"
echo "== switch-back: ベンダー別のログイン状態の保持"
gui switch-back

echo "== ランナーの許可バイナリ・ネットワークコンテナの構成"
check "モックランナーは許可バイナリ以外（/bin/sh）を403で拒否する" bash -c "[ \"\$($(declare -f runner_exec_status); DC='$DC'; runner_exec_status runner-mockproton /var/run/vpngw-ctl/runner-mockproton.sock /bin/sh)\" = 403 ]"
check "AdGuardランナーは別ベンダー（モック）のバイナリを403で拒否する（ランナー経由の踏み台にならない）" bash -c "[ \"\$($(declare -f runner_exec_status); DC='$DC'; runner_exec_status runner-adguardvpn /var/run/vpngw-ctl/runner-adguardvpn.sock /usr/local/bin/protonvpn-mock)\" = 403 ]"
check "ネットワークコンテナ（proxy）にベンダーCLIが含まれない" bash -c "! $DC exec -T proxy sh -c 'test -e /usr/local/bin/adguardvpn-cli'"
check "ネットワークコンテナは/execを持たない（404）" bash -c "[ \"\$($DC exec -T proxy node -e 'const http=require(\"node:http\");const r=http.request({socketPath:\"/var/run/vpngw-ctl/net.sock\",path:\"/exec\",method:\"POST\"},(res)=>{console.log(res.statusCode);res.resume()});r.end(\"{}\")')\" = 404 ]"

echo "== unavailable: ランナー停止中のベンダーは選択できない"
# 選択中のベンダーは（ランナーが止まっても）選択状態のまま操作対象なので、先に別のベンダー（AdGuard VPN）へ切り替えておく。
curl -s -b "$E2E_COOKIE_JAR" -X PUT -H 'content-type: application/json' -d '{"providerId":"adguardvpn"}' "$BASE/api/v1/providers/active" >/dev/null
$DC stop runner-mockproton >/dev/null 2>&1
gui unavailable
$DC start runner-mockproton >/dev/null 2>&1
sleep 3
check "ランナー再開後は利用可能に戻る" bash -c "curl -s -b \"\$E2E_COOKIE_JAR\" $BASE/api/v1/providers | grep -q '\"id\":\"mockproton\".*\"available\":true'"

echo "== 結果: FAIL=$FAILS"
exit "$FAILS"
