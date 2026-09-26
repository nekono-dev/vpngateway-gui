#!/bin/bash
# 責務: Phase 27（設定の動作検証）の完了基準を、Phase 14のLXDラボ（検証サーバ上）で自動検証する（モックVPN・モックDNS）。
# 実行: 検証サーバ上で `bash e2e/phase27/scenarios.sh [A|B|... ...]`（省略時は全シナリオ）。先に e2e/phase14/lab.sh create、
#       p14-gwへのインストール、e2e/phase27/prepare.sh を済ませておくこと。
# ブラウザの動作（開始直後の出口IPの取得と提出・検証用の名前の解決）は、LAN端末役（p14-client）のcurl・digで代行する
# （Web UIそのものの検証は webgui-phase27.mjs が、LAN端末役のブラウザで行う）。
#   A: 全機能を有効にしたVPN接続中の検証で、全13項目がOK。検証の問い合わせは検証専用のClientIDで上流へ届き、検証名は上流へ届かない
#   B: 無効な機能の項目は対象外（理由つき）になり、実行されない
#   C: VPN未接続（Kill Switch ON）では、トンネル・端末の出口の項目は未確認、構成の項目はOK
#   D: 故障の注入: forwardチェーン末尾の遮断ルールを消すと、透過ゲートウェイ・Kill Switchの構成がNG。設定の再反映で回復する
#   E: 故障の注入: 迂回の印を付けるルールを消すと、迂回の経路がNG
#   F: 故障の注入: 上流（自宅DNSサーバ）が応答しないと、DNS中継の名前解決がNG
#   G: 端末がゲートウェイを経由しないと、この端末の出口IPがNG
#   H: 53番リダイレクトの判定（誘導されない直接指定・届かない・この端末が誘導された・誘導の実績）
#   I: 同時実行は409、監査ログにverification_runが残る、未知のIDは404
# 経路の判別: IP確認サービス（203.0.113.20:8443）が見る接続元IPで判定する（VPN出口経由=10.98.1.30）。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
export GW_MODE=lxc GW_NAME=p14-gw CLIENT_NAME=p14-client
. "$HERE/../lxc/env.sh"
. "$HERE/../lib/gw.sh"
. "$HERE/../lib/api-auth.sh"

GW_LAN=10.98.1.10
ECHO_URL=https://203.0.113.20:8443
CA_FILE=/tmp/p14-doh-ca.pem
FAILS=0
ONLY="$*"

ok()    { echo "PASS: $1"; }
ng()    { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
check() { if eval "$2"; then ok "$1"; else ng "$1"; fi; }
run()   { [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]; }

cl()   { lxc exec p14-client -- "$@"; }
dnsc() { lxc exec p14-dns -- "$@"; }
mock_set() { dnsc curl -s "http://127.0.0.1:9000/set?name=$1&ip=$2&ttl=${3:-60}" >/dev/null; }
api() { gw curl -sk -m 60 -b "$GW_COOKIE_JAR" -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "https://localhost:8080/api$2"; }
api_status() { gw curl -sk -m 60 -o /dev/null -w '%{http_code}' -b "$GW_COOKIE_JAR" -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "https://localhost:8080/api$2"; }
# 設定を更新する（全機能を有効にした基本設定に、引数のJSONを重ねる）: cfg '{"killSwitch":false}'
cfg() {
  local body
  body=$(python3 - "$1" "$CA_FILE" "$ECHO_URL" <<'PY'
import json, sys
base = {
  "killSwitch": True, "transparentGatewayEnabled": True,
  "explicitProxyEnabled": True, "explicitProxyAllowedCidrs": ["10.98.1.0/24"],
  "excludedDomains": ["a.example.test", "*.wild.example.test"],
  "dnsRelayEnabled": True, "dnsUpstreamUrl": "https://10.98.1.40/dns-query", "dnsUpstreamCaPem": open(sys.argv[2]).read(),
  "dnsFailureMode": "failClosed", "dnsFallbackServers": [], "dnsClientNameServers": [],
  "dnsRedirectEnabled": True, "dnsRedirectExcludedCidrs": [], "verifyEchoUrl": sys.argv[3],
}
base.update(json.loads(sys.argv[1]))
print(json.dumps(base))
PY
)
  api PUT /v1/connection/config "$body"
}
gateway_field() { api GET /v1/connection/gateway | python3 -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }
wait_for() { local n=$1; shift; for _ in $(seq "$n"); do if eval "$1"; then return 0; fi; sleep 1; done; return 1; }
vpn_up()   { gw ip route replace default via 10.99.0.30 dev eth1; wait_for 25 '[ "$(gateway_field "[\"transparentGateway\"].get(\"vpnInterface\",\"\")")" = eth1 ]'; }
vpn_down() { gw ip route replace default via 10.98.1.1 dev eth0; wait_for 25 '[ -z "$(gateway_field "[\"transparentGateway\"].get(\"vpnInterface\",\"\")")" ]'; }
# LAN端末役のDNSサーバを設定する（192.0.2.53は存在しない宛先。53番リダイレクトでのみ解決できる）。
client_dns() { cl sh -c "systemctl disable --now systemd-resolved >/dev/null 2>&1; rm -f /etc/resolv.conf; echo 'nameserver $1' > /etc/resolv.conf"; }
# 設定を変えてルールセットを作り直す（誘導の記録のset`redirected4`も空になる）。
reconcile() { cfg '{"dnsRedirectExcludedCidrs":["192.0.2.99/32"]}' >/dev/null; sleep 2; cfg '{}' >/dev/null; sleep 3; }
# nftのルールを、特徴（文字列）で1つ削除する: nft_delete <チェーン> <ルールに含まれる文字列>
nft_delete() {
  local handle
  handle=$(gw nft -a list chain inet vpngwgui "$1" | grep -F "$2" | sed -n 's/.*# handle \([0-9]*\).*/\1/p' | tail -n1)
  [ -n "$handle" ] && gw nft delete rule inet vpngwgui "$1" handle "$handle"
}

# 目的: ブラウザの代役として検証を実行し、完了した検証（JSON）をファイルへ保存してIDを返す。
# 入力: $1 = 出口IPを取得・提出するか（yes/no）、$2 = 検証名を解決させるか（yes/no）
LAST=/tmp/p27-last.json
verify() {
  local egress=${1:-yes} resolve=${2:-yes} body id name ip
  body=$(api POST /v1/verifications)
  id=$(printf '%s' "$body" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])' 2>/dev/null)
  [ -n "$id" ] || { echo "開始に失敗: $body" >&2; return 1; }
  name=$(printf '%s' "$body" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("clientProbe",{}).get("dnsName",""))')
  if [ "$resolve" = yes ] && [ -n "$name" ]; then cl dig +time=2 +tries=1 "$name" >/dev/null 2>&1; fi
  if [ "$egress" = yes ]; then
    ip=$(cl curl -sk -m 8 "$ECHO_URL/" 2>/dev/null | tr -d '\r\n')
    api PUT "/v1/verifications/$id/client-observations/egress-ip" "{\"ip\": $([ -n "$ip" ] && echo "\"$ip\"" || echo null)}" >/dev/null
  fi
  wait_for 90 '[ "$(api GET /v1/verifications/$id | python3 -c "import json,sys;print(json.load(sys.stdin)[\"state\"])")" = completed ]' \
    || echo "警告: 検証が完了しない" >&2
  api GET "/v1/verifications/$id" > "$LAST"
  echo "$id"
}
# 直近の検証の項目の値: field <項目ID> [status|observed|reason|expected|hint]
field() { python3 -c "import json,sys;c=[x for x in json.load(open('$LAST'))['checks'] if x['id']==sys.argv[1]][0];print(c.get(sys.argv[2],''))" "$1" "${2:-status}"; }
# 直近の検証の全項目の状態（ID=状態）を1行に並べる（FAIL時の確認用）
statuses() { python3 -c "import json;print(' '.join(f\"{c['id']}={c['status']}\" for c in json.load(open('$LAST'))['checks']))"; }
expect_status() { # expect_status <説明> <項目ID> <状態>
  if [ "$(field "$2")" = "$3" ]; then ok "$1"; else ng "$1（$2=$(field "$2") / $(field "$2" observed)$(field "$2" reason)）"; fi
}

echo "== 準備: ログイン、モックDNSの対応表、LAN端末役のDNS、全機能を有効にした設定、VPN接続"
gw_api_login
mock_set a.example.test 203.0.113.10
mock_set x.wild.example.test 203.0.113.11
mock_set www.wild.example.test 203.0.113.11
mock_set example.com 203.0.113.13
client_dns 192.0.2.53
cl ip route replace default via $GW_LAN dev eth0
cfg '{}' >/dev/null
vpn_up || ng "VPN接続（デフォルトルートの張り替え）をproxyが検出できない"
wait_for 30 '[ "$(gateway_field "[\"dnsRelay\"][\"state\"]")" = active ] && [ "$(gateway_field "[\"explicitProxy\"][\"state\"]")" = active ]' \
  || echo "警告: DNS中継・明示的プロキシがactiveにならない"

ALL_IDS="gateway-rules kill-switch-rules dns-relay-listening dns-redirect-rules explicit-proxy-listening tunnel-egress dns-relay-resolve bypass-set bypass-routing bypass-isolation explicit-proxy-egress client-egress dns-redirect-path"

if run A; then
  echo "== A: 全機能を有効にしたVPN接続中の検証"
  dnsc curl -s http://127.0.0.1:9000/clear >/dev/null
  verify yes yes >/dev/null
  for id in $ALL_IDS; do expect_status "$id がOK" "$id" pass; done
  check "トンネルの出口IPはVPN出口（10.98.1.30）" '[ "$(field tunnel-egress observed)" = "10.98.1.30（eth1 経由）" ]'
  check "この端末の出口IPがVPNの出口と一致" '[ "$(field client-egress observed)" = "10.98.1.30（VPN の出口と一致）" ]'
  check "53番リダイレクトは、この端末の問い合わせで確認できた" '[ "$(field dns-redirect-path observed)" = "この端末の問い合わせが、中継リゾルバへ誘導されたことを確認" ]'
  check "迂回の経路: 印付きは実回線（eth0）、印なしはVPN（eth1）" '[ "$(field bypass-routing observed)" = "迂回: eth0（実回線）、印なし: eth1（VPN）" ]'
  check "検証の問い合わせは、検証専用のClientID（vpngw-selfcheck）で上流へ届く" 'dnsc curl -s http://127.0.0.1:9000/log | grep -q "^doh vpngw-selfcheck "'
  check "検証名（vpngw-<乱数>）は上流へ転送されない" '! dnsc curl -s http://127.0.0.1:9000/log | grep -q " vpngw-[0-9a-f]\{16\}\.example\.com"'
  check "53番リダイレクトのルールが、誘導した送信元をredirected4へ記録している" 'gw nft list set inet vpngwgui redirected4 | grep -q "10.98.1.20"'
  [ "$FAILS" -eq 0 ] || statuses
fi

if run B; then
  echo "== B: 無効な機能の項目は対象外"
  cfg '{"explicitProxyEnabled":false,"dnsRelayEnabled":false}' >/dev/null; sleep 3
  verify yes yes >/dev/null
  for id in explicit-proxy-listening explicit-proxy-egress; do expect_status "$id は対象外" "$id" notApplicable; done
  for id in dns-relay-listening dns-redirect-rules dns-relay-resolve bypass-set bypass-routing bypass-isolation dns-redirect-path; do
    expect_status "$id は対象外" "$id" notApplicable
  done
  check "対象外の理由を示す（DNS中継が無効のため）" '[ "$(field dns-relay-listening reason)" = "DNS中継が無効のため" ]'
  for id in gateway-rules kill-switch-rules tunnel-egress client-egress; do expect_status "$id は実行されOK" "$id" pass; done
  cfg '{}' >/dev/null; sleep 3
fi

if run C; then
  echo "== C: VPN未接続（Kill Switch ON）"
  vpn_down
  verify yes yes >/dev/null
  expect_status "透過ゲートウェイの構成はOK（遮断中）" gateway-rules pass
  check "透過ゲートウェイの構成の観測値が遮断中を示す" '[ "$(field gateway-rules observed)" = "VPN未接続のため、LANからの転送は遮断中（Kill Switch）" ]'
  expect_status "Kill Switchの構成はOK" kill-switch-rules pass
  expect_status "VPNトンネルの出口IPは未確認（VPN未接続）" tunnel-egress unconfirmed
  expect_status "明示的プロキシ経由の出口IPは未確認" explicit-proxy-egress unconfirmed
  expect_status "この端末の出口IPは未確認（遮断中でIP確認サービスへ届かない）" client-egress unconfirmed
  vpn_up
fi

if run D; then
  echo "== D: 故障の注入（forward末尾の遮断ルールの削除）"
  nft_delete forward "iifname \"eth0\" drop" || ng "遮断ルールを削除できない"
  verify yes yes >/dev/null
  expect_status "透過ゲートウェイの構成がNG" gateway-rules fail
  expect_status "Kill Switchの構成がNG" kill-switch-rules fail
  check "NGの観測値に、欠けているルールを示す" '[ "$(field kill-switch-rules observed)" = "転送の遮断ルール（末尾）が無い" ]'
  check "NGに対処のヒントがある" '[ -n "$(field kill-switch-rules hint)" ]'
  reconcile
  verify yes yes >/dev/null
  expect_status "設定の再反映で、透過ゲートウェイの構成がOKに戻る" gateway-rules pass
fi

if run E; then
  echo "== E: 故障の注入（迂回の印を付けるルールの削除）"
  nft_delete bypass_mark "ip daddr @bypass4" || ng "迂回の印のルールを削除できない"
  verify yes yes >/dev/null
  expect_status "迂回の経路がNG" bypass-routing fail
  check "観測値が、印を付けるルールが無いことを示す" '[ "$(field bypass-routing observed)" = "迂回対象の宛先に印を付けるルールが無い" ]'
  reconcile
fi

if run F; then
  echo "== F: 故障の注入（上流の自宅DNSサーバが応答しない）"
  dnsc curl -s "http://127.0.0.1:9000/doh?state=down" >/dev/null
  verify yes yes >/dev/null
  expect_status "DNS中継の名前解決がNG" dns-relay-resolve fail
  expect_status "迂回対象ドメインの登録は、名前解決できず未確認" bypass-set unconfirmed
  dnsc curl -s "http://127.0.0.1:9000/doh?state=up" >/dev/null
  sleep 1
fi

if run G; then
  echo "== G: 端末がゲートウェイを経由しない"
  cl ip route replace default via 10.98.1.1 dev eth0
  verify yes yes >/dev/null
  expect_status "この端末の出口IPがNG" client-egress fail
  check "観測値は、この端末の実際の出口IP（10.98.1.20）" '[ "$(field client-egress observed)" = 10.98.1.20 ]'
  cl ip route replace default via $GW_LAN dev eth0
fi

if run H; then
  echo "== H: 53番リダイレクトの判定"
  client_dns $GW_LAN
  reconcile
  verify yes yes >/dev/null
  expect_status "ゲートウェイをDNSサーバに直接指定した端末は未確認（誘導の実績なし）" dns-redirect-path unconfirmed
  check "理由: ゲートウェイを直接使っている" '[[ "$(field dns-redirect-path reason)" == *"直接使っている"* ]]'
  client_dns 192.0.2.53
  reconcile
  verify yes no >/dev/null
  expect_status "問い合わせが届かず、実績も無ければ未確認" dns-redirect-path unconfirmed
  check "理由: 中継リゾルバへ届かなかった（暗号化DNS等の確認を促す）" '[[ "$(field dns-redirect-path hint)" == *"暗号化DNS"* ]]'
  verify yes yes >/dev/null
  expect_status "この端末の問い合わせが誘導されればOK" dns-redirect-path pass
  verify yes no >/dev/null
  expect_status "この端末で確認できなくても、直近の誘導の実績があればOK" dns-redirect-path pass
  check "観測値が実績である旨を示す" '[[ "$(field dns-redirect-path observed)" == *"実績あり"* ]]'
fi

if run I; then
  echo "== I: 同時実行・監査ログ・未知のID"
  first=$(api POST /v1/verifications | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  check "実行中の開始は409" '[ "$(api_status POST /v1/verifications)" = 409 ]'
  api PUT "/v1/verifications/$first/client-observations/egress-ip" '{"ip": null}' >/dev/null
  wait_for 90 '[ "$(api GET /v1/verifications/$first | python3 -c "import json,sys;print(json.load(sys.stdin)[\"state\"])")" = completed ]'
  check "監査ログにverification_runが記録される（IP・名前は含まない）" 'api GET /v1/connection/log | python3 -c "import json,sys;e=[x for x in json.load(sys.stdin) if x[\"action\"]==\"verification_run\"][-1];assert set(e[\"input\"])=={\"checks\",\"pass\",\"fail\",\"unconfirmed\"}"'
  check "未知のIDは404" '[ "$(api_status GET /v1/verifications/00000000-0000-0000-0000-000000000000)" = 404 ]'
  check "IPv4でない出口IPの提出は400" '[ "$(api_status PUT /v1/verifications/$first/client-observations/egress-ip "{\"ip\":\"2001:db8::1\"}")" = 400 ]'
fi

echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
