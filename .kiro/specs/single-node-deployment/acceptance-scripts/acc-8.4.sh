#!/usr/bin/env bash
# shellcheck disable=SC2016 # ip netns exec 内で評価する probe script の変数。
# 根拠: tasks.md 331-336、acceptance-env.md 309-337。
# guard state/lease: proxy/src/network/gateway-guard.ts、guard-ruleset.ts。
# settings 503契約: api/src/routes/connection-config.ts 18-77。
# API認証とCookie: e2e/hosted/fixtures/gateway.ts 44-60、stack.ts 12-16。
# 停止計測例: acceptance-env.md 314-330。container名は docker compose ps -q proxy から取得。
set -uo pipefail
ROOT=$PWD
# probe ログは再起動で消えない場所に置けるよう OUT で変えられる
OUT=${OUT:-/tmp/lab-acc}
source e2e/hosted/lib/env.sh
BASE="http://127.0.0.1:${E2E_WEB_PORT}/api"
LAN_IFACE=${LAN_IFACE:-$E2E_BRIDGE}
mkdir -p "$OUT"
cd "$ROOT" || exit 1
PROXY=$(docker compose -p vpngwgui ps -q proxy 2>/dev/null | head -n1)
[[ -n $PROXY ]] || { echo 'proxy container が見つからない'; exit 1; }
COOKIE=$OUT/admin.cookie
CREDS=${ADMIN_CREDENTIALS_FILE:-e2e/hosted/.work/admin.json}
original_policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$PROXY")
original_max=$(docker inspect -f '{{.HostConfig.RestartPolicy.MaximumRetryCount}}' "$PROXY")
if [[ $original_policy == on-failure && $original_max != 0 ]]; then original_policy="on-failure:$original_max"; fi
initial=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/config" 2>/dev/null || true)
if [[ -z $initial ]]; then
  [[ -r $CREDS ]] || { echo "管理者資格情報がありません: $CREDS。既存アカウントの資格情報を ADMIN_CREDENTIALS_FILE に指定してください"; exit 2; }
  user=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).username" "$CREDS")
  pass=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).password" "$CREDS")
  curl -sS -c "$COOKIE" -H 'content-type: application/json' -d "$(node -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))' "$user" "$pass")" "$BASE/v1/operator/session" >/dev/null
  initial=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/config" 2>/dev/null || true)
fi
[[ -n $initial ]] || { echo '管理者 login/API config GET に失敗'; exit 1; }
ORIGINAL_CONFIG=$initial
ORIGINAL_CONNECTION=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection" | node -p 'JSON.parse(fs.readFileSync(0,"utf8")).status')
orig_ks=$(node -p 'JSON.parse(process.argv[1]).killSwitch' "$initial")
orig_tg=$(node -p 'JSON.parse(process.argv[1]).transparentGatewayEnabled' "$initial")
paused=0
policy_changed=0
restore() {
  if [[ $paused == 1 ]]; then docker unpause "$PROXY" >/dev/null 2>&1 || true; fi
  docker start "$PROXY" >/dev/null 2>&1 || true
  if [[ $policy_changed == 1 ]]; then docker update --restart="$original_policy" "$PROXY" >/dev/null 2>&1 || true; fi
  curl -sS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "$ORIGINAL_CONFIG" "$BASE/v1/connection/config" >/dev/null 2>&1 || true
  if [[ $ORIGINAL_CONNECTION == connected ]]; then
    country=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/locations" | node -p 'JSON.parse(fs.readFileSync(0,"utf8"))[0].country')
    city=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/locations/$country/cities" | node -p 'JSON.parse(fs.readFileSync(0,"utf8"))[0].id')
    curl -sS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "{\"connect\":true,\"locationId\":\"$city\"}" "$BASE/v1/connection" >/dev/null 2>&1 || true
  else curl -sS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d '{"connect":false}' "$BASE/v1/connection" >/dev/null 2>&1 || true; fi
  rm -f "$COOKIE"
}
trap restore EXIT INT TERM
stamp_ms() { date -u '+%Y-%m-%dT%H:%M:%S.%3NZ'; }
wait_lease() {
  for _ in {1..60}; do
    state=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/gateway" 2>/dev/null | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(JSON.parse(s).gatewayGuard?.state||"")}catch{}})')
    [[ $state == LEASE || $state == OFF ]] && return 0
    sleep 0.5
  done
  return 1
}
probe_loop() {
  local logfile=$1
  ip netns exec lan sh -c "while :; do t=\$(date +%s%3N); if curl --connect-timeout 0.25 --max-time 0.45 -sS -o /dev/null http://192.168.50.1:${E2E_WEB_PORT}/; then echo \"\$t OK\"; else echo \"\$t FAIL\"; fi; sleep 0.1; done" >"$logfile" 2>&1 &
  PROBE_PID=$!
}
stop_probe() { kill "$PROBE_PID" 2>/dev/null || true; wait "$PROBE_PID" 2>/dev/null || true; }
echo "元設定: killSwitch=$orig_ks transparentGatewayEnabled=$orig_tg"
curl -fsS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d '{"providerId":"protonvpn"}' "$BASE/v1/providers/active" >/dev/null || exit 1
curl -fsS -b "$COOKIE" -H 'content-type: application/json' -X POST -d '{"username":"mock-user@example.test","password":"mock-password","twoFactorCode":"123456"}' "$BASE/v1/session" >/dev/null || exit 1
curl -fsS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d '{"transparentGatewayEnabled":true,"killSwitch":true,"explicitProxyEnabled":false,"dnsRelayEnabled":false,"excludedDomains":[]}' "$BASE/v1/connection/config" >/dev/null || exit 1
locations=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/locations")
country=$(node -p 'JSON.parse(process.argv[1])[0].country' "$locations")
cities=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/locations/$country/cities")
city=$(node -p 'JSON.parse(process.argv[1])[0].id' "$cities")
curl -fsS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "{\"connect\":true,\"locationId\":\"$city\"}" "$BASE/v1/connection" >/dev/null || exit 1
for _ in {1..60}; do [[ $(curl -fsS -b "$COOKIE" "$BASE/v1/connection" | node -p 'JSON.parse(fs.readFileSync(0,"utf8")).status') == connected ]] && break; sleep 2; done
sleep 12
docker update --restart=no "$PROXY" >/dev/null; policy_changed=1
printf 'ケース名\tKill Switch\t停止方式\t要求時刻\t最後の成功\t最初の失敗\t経過ms\tguard state\t判定\n'
for ks in true false; do
  curl -fsS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "{\"transparentGatewayEnabled\":true,\"killSwitch\":$ks}" "$BASE/v1/connection/config" >/dev/null || exit 1
  for mode in kill pause stop; do
    if [[ $mode == pause ]]; then docker unpause "$PROXY" >/dev/null 2>&1 || true; paused=0; fi
    if [[ $mode == stop ]]; then docker start "$PROXY" >/dev/null 2>&1 || true; fi
    wait_lease || echo "LEASE/OFF 待機 timeout"
    logfile="$OUT/probe-${ks}-${mode}.log"
    probe_loop "$logfile"
    sleep 1
    req=$(date +%s%3N)
    case $mode in
      kill) docker kill -s KILL "$PROXY" >/dev/null 2>&1 ;;
      pause) docker pause "$PROXY" >/dev/null 2>&1 && paused=1 ;;
      stop) docker stop "$PROXY" >/dev/null 2>&1 ;;
    esac
    sleep 7
    stop_probe
    last_ok=$(awk '$2=="OK"{v=$1} END{print v+0}' "$logfile")
    first_fail=$(awk -v r="$req" '$1>=r && $2=="FAIL"{print $1;exit}' "$logfile")
    [[ -n $first_fail ]] || first_fail=none
    elapsed=NA; [[ $first_fail != none ]] && elapsed=$((first_fail-req))
    state=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/gateway" 2>/dev/null | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(JSON.parse(s).gatewayGuard?.state||"UNKNOWN")}catch{process.stdout.write("UNKNOWN")}})')
    drop=0; nft list chain inet vpngwgui_guard guard_forward 2>/dev/null | grep -q "iifname \"$LAN_IFACE\" drop" && drop=1
    verdict=FAIL
    if [[ $ks == true && $first_fail != none && $elapsed -le 6000 && $drop == 1 ]]; then verdict=PASS; fi
    if [[ $ks == false && $drop == 0 && $state == OFF ]]; then verdict=PASS; fi
    # 停止要求以降の probe の成功・失敗回数（Kill Switch 無効で通信が続いたことの実測値）
    ok_after=$(awk -v r="$req" '$1>=r && $2=="OK"{n++} END{print n+0}' "$logfile")
    fail_after=$(awk -v r="$req" '$1>=r && $2=="FAIL"{n++} END{print n+0}' "$logfile")
    last_after=$(awk -v r="$req" '$1>=r{v=$1" "$2} END{print v}' "$logfile")
    echo "[$(stamp_ms)] $ks-$mode: 停止要求以降の probe 成功=$ok_after 失敗=$fail_after 最後の probe=$last_after"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s (drop=%s)\t%s\n' "$ks-$mode" "$ks" "$mode" "$req" "$last_ok" "$first_fail" "$elapsed" "$state" "$drop" "$verdict"
    echo "[$(stamp_ms)] $ks-$mode: probe=$logfile nft_guard=$(nft -a list table inet vpngwgui_guard 2>&1)"
    # case の停止後は必ず同じ container を起動し、設定適用・lease 回復を待つ。
    docker start "$PROXY" >/dev/null 2>&1 || docker unpause "$PROXY" >/dev/null 2>&1 || true
    paused=0
    wait_lease || true
  done
done

# proxy停止時に有効ガード変更を拒否し、永続値不変と復帰後反映を確認する。
for field in killSwitch transparentGatewayEnabled; do
  docker pause "$PROXY" >/dev/null; paused=1
  before=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/config")
  cur=$(node -p "JSON.parse(process.argv[1]).$field" "$before")
  next=false; [[ $cur == false ]] && next=true
  response=$(curl -sS -w '\nHTTP_CODE=%{http_code}' -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "{\"$field\":$next}" "$BASE/v1/connection/config")
  echo "proxy停止中 $field PUT $(stamp_ms): $response"
  after=$(curl -fsS -b "$COOKIE" "$BASE/v1/connection/config")
  [[ $(node -p "JSON.parse(process.argv[1]).$field" "$after") == "$cur" ]] || echo "FAIL 永続値変化: $field"
  docker unpause "$PROXY" >/dev/null; paused=0
  sleep 2
  retry=$(curl -sS -w '\nHTTP_CODE=%{http_code}' -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "{\"$field\":$next}" "$BASE/v1/connection/config")
  echo "proxy再開後 $field PUT $(stamp_ms): $retry"
  curl -sS -b "$COOKIE" -H 'content-type: application/json' -X PUT -d "{\"$field\":$cur}" "$BASE/v1/connection/config" >/dev/null || true
done
echo '設定復元と restart policy 復元は終了 trap で実行する。'
