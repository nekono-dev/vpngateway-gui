#!/usr/bin/env bash
# 根拠: tasks.md 324-329、acceptance-env.md 248-307。
# probe 対応: e2e/hosted/specs/gateway/transparent.spec.ts 47-82（5.1/5.4）、dns.spec.ts 64-76（6.1/6.2）、verification.spec.ts 55-68（8.1）。
# API 手順: fixtures/gateway.ts 44-125、fixtures/stack.ts 12-16。
set -uo pipefail
ROOT=$PWD
cd "$ROOT" || exit 1
OUT=/tmp/lab-acc
source e2e/hosted/lib/env.sh
BASE="http://127.0.0.1:${E2E_WEB_PORT}/api"
LAN_IFACE=${LAN_IFACE:-$E2E_BRIDGE}
mkdir -p "$OUT"
PROXY=$(docker compose -p vpngwgui ps -q proxy 2>/dev/null | head -n1)
COOKIE=$(mktemp)
CREDS=e2e/hosted/.work/admin.json
OVERALL=0
paused=0
stamp() { date -u '+%Y-%m-%dT%H:%M:%S.%3NZ'; }
result() { printf '[%s] %s: %s\n' "$(stamp)" "$1" "$2"; [[ $2 == PASS ]] || OVERALL=1; }
api() { curl -fsS -b "$COOKIE" -H 'content-type: application/json' "$@"; }
login() {
  if [[ -r $CREDS ]]; then
    user=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).username" "$CREDS")
    pass=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).password" "$CREDS")
  else
    state=$(curl -fsS "$BASE/v1/operator") || return 1
    configured=$(node -p 'JSON.parse(process.argv[1]).configured' "$state")
    [[ $configured == false ]] || { echo "資格情報が無く管理者作成もできません: $CREDS"; return 1; }
    user="admin$(openssl rand -hex 3)"; pass="Pw-$(openssl rand -hex 12)"
    printf '{"username":"%s","password":"%s"}\n' "$user" "$pass" > "$CREDS"; chmod 600 "$CREDS"
    api -X POST -d "$(node -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))' "$user" "$pass")" "$BASE/v1/operator" >/dev/null || return 1
  fi
  api -c "$COOKIE" -X POST -d "$(node -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))' "$user" "$pass")" "$BASE/v1/operator/session" >/dev/null
}
put_config() { api -X PUT -d "$1" "$BASE/v1/connection/config" >/dev/null; }
wait_connection() {
  local want=$1 state
  for _ in {1..60}; do
    state=$(api "$BASE/v1/connection" 2>/dev/null | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(JSON.parse(s).status)}catch{}})')
    [[ $state == "$want" ]] && return 0
    sleep 2
  done
  return 1
}
wait_lease() {
  for _ in {1..60}; do
    nft list set inet vpngwgui_guard healthy_lease4 2>/dev/null | grep -q "$LAN_IFACE" && return 0
    sleep .5
  done
  return 1
}
probe() {
  local path=$1 expected=$2 actual rc
  case $path in
    dnat) actual=$(ip netns exec lan curl --max-time 5 -sS -o /dev/null -w '%{http_code}' "http://192.168.50.1:${E2E_WEB_PORT}/") ;;
    dns) actual=$(ip netns exec lan getent ahostsv4 relay.e2e.test 2>/dev/null | awk 'NR==1{print $1}') ;;
    redirect)
      if [[ $expected == FAIL ]]; then actual=$(ip netns exec lan node_modules/.bin/tsx e2e/hosted/services/dns-query.ts 198.51.100.254 redirect.e2e.test 2>/dev/null)
      else
        put_config '{"dnsRedirectEnabled":false}' || return 1
        direct=$(ip netns exec lan node_modules/.bin/tsx e2e/hosted/services/dns-query.ts 198.51.100.254 redirect.e2e.test 2>/dev/null)
        put_config '{"dnsRedirectEnabled":true}' || return 1
        actual=$(ip netns exec lan node_modules/.bin/tsx e2e/hosted/services/dns-query.ts 198.51.100.254 redirect.e2e.test 2>/dev/null)
        printf 'DNS redirect control: direct=%s expected=203.0.113.99; redirected=%s expected=NXDOMAIN\n' "$direct" "$actual"
        [[ $direct == 203.0.113.99 && $actual == NXDOMAIN ]] || return 1
        return 0
      fi ;;
    vpn) actual=$(ip netns exec lan curl --cacert e2e/hosted/.work/certs/ca.crt --max-time 8 -sS https://198.51.100.254/) ;;
    bypass) ip netns exec lan getent ahostsv4 bypass.e2e.test >/dev/null 2>&1; actual=$(ip netns exec lan curl --cacert e2e/hosted/.work/certs/ca.crt --max-time 8 -sS https://198.51.100.253/) ;;
  esac
  rc=$?
  printf 'probe=%s actual=%s expected=%s\n' "$path" "${actual:-<empty>}" "$expected"
  # dns-query.ts は応答がないと終了コード 0 で TIMEOUT を出すため、これも遮断（応答なし）として扱う
  if [[ $expected == FAIL ]]; then { (( rc != 0 )) || [[ $actual == TIMEOUT ]]; } && return 0 || return 1; fi
  [[ $rc == 0 && $actual == "$expected" ]]
}
cleanup() {
  if [[ -n ${PROXY:-} && $paused == 1 ]]; then docker unpause "$PROXY" >/dev/null 2>&1 || true; fi
  if [[ -n ${ORIGINAL_CONFIG:-} && -n ${COOKIE:-} ]]; then put_config "$ORIGINAL_CONFIG" >/dev/null 2>&1 || true; fi
  if [[ ${ORIGINAL_CONNECTION:-} == connected ]]; then
    id=$(api "$BASE/v1/connection/locations" 2>/dev/null | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(JSON.parse(s)[0].country)}catch{}})')
    city=$(api "$BASE/v1/connection/locations/$id/cities" 2>/dev/null | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(JSON.parse(s)[0].id)}catch{}})')
    api -X PUT -d "{\"connect\":true,\"locationId\":\"$city\"}" "$BASE/v1/connection" >/dev/null 2>&1 || true
  else api -X PUT -d '{"connect":false}' "$BASE/v1/connection" >/dev/null 2>&1 || true; fi
  rm -f "$COOKIE"
}
trap cleanup EXIT INT TERM
[[ -n $PROXY ]] || { echo 'proxy container が無い'; result runtime FAIL; exit 1; }
login || { echo '管理者 login に失敗'; result admin FAIL; exit 1; }
ORIGINAL_CONFIG=$(api "$BASE/v1/connection/config") || { result config-read FAIL; exit 1; }
ORIGINAL_CONNECTION=$(api "$BASE/v1/connection" | node -p 'JSON.parse(fs.readFileSync(0,"utf8")).status')
# API 設定は gateway spec の透過・DNS・bypass 前提をまとめて有効化する。
# 証明書本文は「-----BEGIN」で始まり node が引数をオプションと誤認するため、ファイルから直接 JSON 文字列にする
CA_JSON=$(node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync("e2e/hosted/.work/certs/ca.crt","utf8")))')
put_config "{\"transparentGatewayEnabled\":true,\"killSwitch\":true,\"explicitProxyEnabled\":false,\"dnsRelayEnabled\":true,\"dnsUpstreamUrl\":\"https://198.51.100.254/dns-query\",\"dnsUpstreamCaPem\":$CA_JSON,\"dnsRedirectEnabled\":true,\"dnsFailureMode\":\"failClosed\",\"dnsFallbackServers\":[],\"excludedDomains\":[\"bypass.e2e.test\"]}" || { result prepare-config FAIL; exit 1; }
api -X PUT -d '{"providerId":"protonvpn"}' "$BASE/v1/providers/active" >/dev/null || { result vpn-provider FAIL; exit 1; }
api -X POST -d '{"username":"mock-user@example.test","password":"mock-password","twoFactorCode":"123456"}' "$BASE/v1/session" >/dev/null || { result vpn-login FAIL; exit 1; }
locations=$(api "$BASE/v1/connection/locations") || { result locations FAIL; exit 1; }
country=$(node -p 'JSON.parse(process.argv[1])[0].country' "$locations")
cities=$(api "$BASE/v1/connection/locations/$country/cities") || { result cities FAIL; exit 1; }
city=$(node -p 'JSON.parse(process.argv[1])[0].id' "$cities")
api -X PUT -d "{\"connect\":true,\"locationId\":\"$city\"}" "$BASE/v1/connection" >/dev/null && wait_connection connected && sleep 12 || { result vpn-connect FAIL; exit 1; }
result 'VPN 接続状態' PASS
ip link show vpn0 >/dev/null 2>&1 && result 'vpn0 tunnel' PASS || result 'vpn0 tunnel' FAIL
live_config=$(api "$BASE/v1/connection/config")
node -e 'const c=JSON.parse(process.argv[1]);process.exit(c.transparentGatewayEnabled && c.dnsRelayEnabled && c.dnsRedirectEnabled ? 0 : 1)' "$live_config" && result '透過・DNS relay・53 redirect 設定' PASS || result '透過・DNS relay・53 redirect 設定' FAIL
result preparation PASS
# 8.3 lease API は製品実装と同じ batch を保持し、実環境のルールは書き換えない。
tmp=$(mktemp); cat >"$tmp" <<NFT
add table inet vpngwgui_syntax_check
add set inet vpngwgui_syntax_check healthy_lease4 { type ifname; flags timeout; }
add chain inet vpngwgui_syntax_check guard_forward { type filter hook forward priority -1; policy accept; }
add rule inet vpngwgui_syntax_check guard_forward iifname @healthy_lease4 return
add rule inet vpngwgui_syntax_check guard_forward iifname "$LAN_IFACE" drop
NFT
nft -c -f "$tmp"; rc=$?; rm -f "$tmp"; result 'nft 構文' "$([[ $rc == 0 ]] && echo PASS || echo FAIL)"
for _n in 1 2 3; do nft -c -f <(printf 'flush chain inet vpngwgui_guard guard_forward\nflush set inet vpngwgui_guard healthy_lease4\nadd element inet vpngwgui_guard healthy_lease4 { "%s" timeout 4s }\nadd rule inet vpngwgui_guard guard_forward iifname @healthy_lease4 return\nadd rule inet vpngwgui_guard guard_forward iifname "%s" drop\n' "$LAN_IFACE" "$LAN_IFACE") || OVERALL=1; done
result '遷移 batch 構文 3 回' "$([[ $OVERALL == 0 ]] && echo PASS || echo FAIL)"
for spec in 'dnat|200' 'dns|198.51.100.254' 'redirect|NXDOMAIN' 'vpn|192.168.50.200' 'bypass|192.168.50.1'; do
  name=${spec%%|*}; expect=${spec#*|}; probe "$name" "$expect"; rc=$?; result "$name LEASE" "$([[ $rc == 0 ]] && echo PASS || echo FAIL)"
  if [[ $name == bypass ]]; then ip netns exec lan getent ahostsv4 bypass.e2e.test | awk 'NR==1{print $1}' | grep -qx '198.51.100.253' || result 'bypass DNS' FAIL; nft list set inet vpngwgui bypass4 2>/dev/null | grep -q '198.51.100.253' && result 'bypass set' PASS || result 'bypass set' FAIL; fi
  docker pause "$PROXY" >/dev/null && paused=1 || { result "$name pause" FAIL; continue; }
  sleep 6
  chain=$(nft list chain inet vpngwgui_guard guard_forward 2>/dev/null)
  set=$(nft list set inet vpngwgui_guard healthy_lease4 2>/dev/null)
  grep -Fq "iifname \"$LAN_IFACE\" drop" <<<"$chain" && ! grep -q 'elements = {.*[[:alnum:]]' <<<"$set" && result "$name BLOCK guard/drop + empty lease" PASS || result "$name BLOCK guard/drop + empty lease" FAIL
  probe "$name" FAIL; rc=$?; result "$name BLOCK" "$([[ $rc == 0 ]] && echo PASS || echo FAIL)"
  docker unpause "$PROXY" >/dev/null && paused=0
  wait_lease && sleep 2 || result "$name lease recovery" FAIL
 done
# proxy 再作成後も guard chain handle を保ち、DNAT を再確認する。
gw_before=$(nft -a list table inet vpngwgui | head -1)
handles_before=$(nft -a list table inet vpngwgui_guard | awk '/^table |^\tset |^\tchain / {print $1, $2, $NF}')
docker restart "$PROXY" >/dev/null && for _ in {1..60}; do [[ $(docker inspect -f '{{.State.Running}}' "$PROXY" 2>/dev/null) == true ]] && break; sleep 1; done
wait_lease || result '再起動後 lease 回復' FAIL
handles_after=$(nft -a list table inet vpngwgui_guard | awk '/^table |^\tset |^\tchain / {print $1, $2, $NF}')
echo "Gateway table 前: $gw_before 後: $(nft -a list table inet vpngwgui | head -1)"; echo "guard handle 前: $(tr '\n' ' ' <<<"$handles_before") 後: $(tr '\n' ' ' <<<"$handles_after")"; [[ -n $handles_before && $handles_before == "$handles_after" ]] && result '再起動後 guard handle 維持' PASS || result '再起動後 guard handle 維持' FAIL
probe dnat 200; rc=$?; result '再起動後 DNAT forward' "$([[ $rc == 0 ]] && echo PASS || echo FAIL)"
printf '全体判定: %s\n' "$([[ $OVERALL == 0 ]] && echo PASS || echo FAIL)"
exit "$OVERALL"
