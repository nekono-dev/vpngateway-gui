#!/bin/bash
# 責務: Phase 14（ドメイン迂回とDNS中継）の完了基準を、lab.shで作ったLXDラボ（検証サーバ上）で自動検証する（モックVPN・モックDNS）。
# 実行: 検証サーバ上で `bash e2e/phase14/scenarios.sh [A|B|... ...]`（省略時は全シナリオ）。先に `lab.sh create` と、p14-gwへの
#       インストール（`sh install/install.sh --providers <ID> --web-port 8080`）を済ませておくこと。
#   A: 迂回対象外の名前解決（中継の疎通）と、VPN未接続時の中継
#   B: VPN接続中、迂回ドメインは実回線（ゲートウェイ自身の送信元）、それ以外はVPN出口を経由する
#   C: 表記規則（完全一致は自身のみ・ワイルドカードはサブドメインのみ）
#   D: 稼働状況（GET /v1/connection/gateway）・ip rule・nft setの実体
#   E: 上流（モックDNS）にクライアントがClientID（MAC由来）で区別されて渡る
#   F: 設定変更による再構成後も迂回対象が維持される
#   G: 名前解決結果のIPの変化に追従し、期限（TTL＋猶予）を過ぎると迂回対象から外れる（約75秒かかる）
#   H: VPN未接続・Kill Switch ONでも、迂回対象だけは疎通し、それ以外は遮断される
#   I: 上流障害時のフェイルクローズ（SERVFAIL）／フォールバック
#   J: 53番リダイレクト（手動でDNSを指定した端末・除外CIDR）
#   K: 明示的プロキシ（透過ゲートウェイと併用／単独）
#   L: DNS中継を無効にすると、待受・迂回のnft・ip ruleが撤去される
#   M: 53番ポートが使用中で待受に失敗したとき、状態がerrorになり、名前解決を止めるリダイレクトは入らない。解消すると自動で回復する
# 経路の判別: 宛先サーバが見る接続元IPで判定する（迂回=10.98.1.10(ゲートウェイ自身)、VPN出口経由=10.98.1.30）。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
export GW_MODE=lxc GW_NAME=p14-gw CLIENT_NAME=p14-client
. "$HERE/../lxc/env.sh"
. "$HERE/../lib/gw.sh"
. "$HERE/../lib/api-auth.sh"

BYPASS_IP=10.98.1.10
VPN_IP=10.98.1.30
GW_LAN=10.98.1.10
CA_FILE=/tmp/p14-doh-ca.pem
FAILS=0
ONLY="$*"

ok()    { echo "PASS: $1"; }
ng()    { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
check() { if eval "$2"; then ok "$1"; else ng "$1"; fi; }
run()   { [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]; }

cl()   { lxc exec p14-client -- "$@"; }
dnsc() { lxc exec p14-dns -- "$@"; }
# モックDNSの名前解決の対応表を設定する: mock_set <名前> <IPv4> [TTL秒]
mock_set() { dnsc curl -s "http://127.0.0.1:9000/set?name=$1&ip=$2&ttl=${3:-60}" >/dev/null; }
# ゲートウェイ役の上でAPIを呼ぶ: api <メソッド> <パス> [JSON]
api() { gw curl -sk -m 60 -b "$GW_COOKIE_JAR" -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "https://localhost:8080/api$2"; }
# 設定を更新する（基本設定に、引数のJSONを重ねる）: cfg '{"killSwitch":false}'
cfg() {
  local body
  body=$(python3 - "$1" "$CA_FILE" <<'PY'
import json, sys
base = {
  "killSwitch": True, "transparentGatewayEnabled": True, "explicitProxyEnabled": False, "explicitProxyAllowedCidrs": [],
  "excludedDomains": ["a.example.test", "*.wild.example.test", "c.example.test"],
  "dnsRelayEnabled": True, "dnsUpstreamUrl": "https://10.98.1.40/dns-query", "dnsUpstreamCaPem": open(sys.argv[2]).read(),
  "dnsFailureMode": "failClosed", "dnsFallbackServers": [], "dnsRedirectEnabled": False, "dnsRedirectExcludedCidrs": [],
}
base.update(json.loads(sys.argv[1]))
print(json.dumps(base))
PY
)
  api PUT /v1/connection/config "$body"
}
gateway_field() { api GET /v1/connection/gateway | python3 -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }
wait_for() { local n=$1; shift; for _ in $(seq "$n"); do if eval "$1"; then return 0; fi; sleep 1; done; return 1; }
# 「VPN接続中」の再現: デフォルトルートを別インターフェース（vpnexit経由のeth1）へ張り替える／戻す
vpn_up()   { gw ip route replace default via 10.99.0.30 dev eth1; wait_for 25 '[ "$(gateway_field "[\"transparentGateway\"].get(\"vpnInterface\",\"\")")" = eth1 ]'; }
vpn_down() { gw ip route replace default via 10.98.1.1 dev eth0; wait_for 25 '[ -z "$(gateway_field "[\"transparentGateway\"].get(\"vpnInterface\",\"\")")" ]'; }
# クライアントから宛先サーバへ名前でHTTP接続し、宛先サーバが見た接続元IPを返す（失敗は空）
src_of() { cl curl -s -m 8 "http://$1:8080/" 2>/dev/null | tr -d '\r\n'; }
src_of_ip() { cl curl -s -m 8 "http://$1:8080/" 2>/dev/null | tr -d '\r\n'; }
nft_dump() { gw nft list table inet vpngwgui 2>&1; }
set_elements() { gw nft list set inet vpngwgui bypass4 2>/dev/null | tr -d '\n'; }

echo "== 準備: ログイン、モックDNSの対応表、クライアントのDNS（=ゲートウェイ）、初期設定"
gw_api_login
mock_set a.example.test 203.0.113.10
mock_set sub.a.example.test 203.0.113.11
mock_set b.example.test 203.0.113.11
mock_set x.wild.example.test 203.0.113.10
mock_set wild.example.test 203.0.113.11
mock_set c.example.test 203.0.113.12 5
mock_set z.example.test 203.0.113.11
cl sh -c "systemctl disable --now systemd-resolved >/dev/null 2>&1; rm -f /etc/resolv.conf; echo 'nameserver $GW_LAN' > /etc/resolv.conf"
gw ip route replace default via 10.98.1.1 dev eth0
cfg '{}' >/dev/null
wait_for 30 '[ "$(gateway_field "[\"dnsRelay\"][\"state\"]")" = active ]' || echo "警告: DNS中継がactiveにならない"

if run A; then
  echo "== A: 中継の疎通"
  check "VPN未接続でも、クライアントの名前解決がゲートウェイの中継を通り上流の応答が返る" '[ "$(cl dig +short +time=3 +tries=1 a.example.test)" = 203.0.113.10 ]'
  check "存在しない名前はNXDOMAIN（上流の応答をそのまま返す）" 'cl dig +time=3 +tries=1 nosuch.example.test | grep -q NXDOMAIN'
fi

if run B; then
  echo "== B: VPN接続中の経路"
  vpn_up || ng "VPN接続（デフォルトルートの張り替え）をproxyが検出できない"
  check "迂回ドメイン(a.example.test)は実回線から出る（宛先が見る接続元=ゲートウェイ自身 $BYPASS_IP）" '[ "$(src_of a.example.test)" = "$BYPASS_IP" ]'
  check "迂回ドメイン以外(b.example.test)はVPN出口を経由する（接続元=$VPN_IP）" '[ "$(src_of b.example.test)" = "$VPN_IP" ]'
fi

if run C; then
  echo "== C: 表記規則"
  vpn_up
  check "完全一致(a.example.test)のみ登録: サブドメイン(sub.a.example.test)は迂回されない" '[ "$(src_of sub.a.example.test)" = "$VPN_IP" ]'
  check "ワイルドカード(*.wild.example.test): サブドメイン(x.wild.example.test)は迂回される" '[ "$(src_of x.wild.example.test)" = "$BYPASS_IP" ]'
  check "ワイルドカードは自身(wild.example.test)を含まない" '[ "$(src_of wild.example.test)" = "$VPN_IP" ]'
fi

if run D; then
  echo "== D: 稼働状況・ルール実体"
  vpn_up; src_of a.example.test >/dev/null
  check "APIの稼働状況: dnsRelay.state=active・upstream=ok" '[ "$(gateway_field "[\"dnsRelay\"][\"state\"]")" = active ] && [ "$(gateway_field "[\"dnsRelay\"][\"upstream\"]")" = ok ]'
  check "APIの稼働状況: bypassEntriesが1以上" '[ "$(gateway_field "[\"dnsRelay\"][\"bypassEntries\"]")" -ge 1 ]'
  check "ip rule に fwmark 0x100 → テーブル100 がある" 'gw ip -4 rule show | grep -q "fwmark 0x100 lookup 100"'
  check "テーブル100に実回線のデフォルトゲートウェイ(10.98.1.1)がある" 'gw ip -4 route show table 100 | grep -q "default via 10.98.1.1 dev eth0"'
  check "nft set bypass4 に迂回対象のIP(203.0.113.10)がある" 'set_elements | grep -q "203.0.113.10"'
  check "nftテーブルに bypass_mark（prerouting）がある" 'nft_dump | grep -q "chain bypass_mark"'
fi

if run E; then
  echo "== E: ClientID"
  MAC=$(cl cat /sys/class/net/eth0/address | tr ':' '-')
  dnsc curl -s http://127.0.0.1:9000/clear >/dev/null
  cl dig +short +time=3 +tries=1 a.example.test >/dev/null
  check "上流（DoH）へ、クライアントのMAC由来のClientID(mac-$MAC)で問い合わせが届く" 'dnsc curl -s http://127.0.0.1:9000/log | grep -q "^doh mac-$MAC a.example.test"'
  check "ゲートウェイ自身からの問い合わせはClientIDが explicit-proxy 固定" 'gw dig +short +time=3 +tries=1 @127.0.0.1 b.example.test >/dev/null; dnsc curl -s http://127.0.0.1:9000/log | grep -q "^doh explicit-proxy b.example.test"'
fi

if run F; then
  echo "== F: 再構成後も迂回対象が維持される"
  vpn_up; src_of a.example.test >/dev/null
  cfg '{"killSwitch":false}' >/dev/null; sleep 2; cfg '{"killSwitch":true}' >/dev/null; sleep 2
  check "設定変更（nftの再構成）の後も、setに迂回対象のIPが残っている" 'set_elements | grep -q "203.0.113.10"'
  check "再構成の後も、迂回ドメインは実回線から出る" '[ "$(src_of_ip 203.0.113.10)" = "$BYPASS_IP" ]'
fi

if run G; then
  echo "== G: IPの変化への追従と期限切れ（約75秒）"
  vpn_up
  mock_set c.example.test 203.0.113.12 5
  check "c.example.test（→.12）は迂回される" '[ "$(src_of c.example.test)" = "$BYPASS_IP" ]'
  mock_set c.example.test 203.0.113.13 5
  check "名前解決結果が.13に変わっても、再解決後は迂回される" '[ "$(src_of c.example.test)" = "$BYPASS_IP" ]'
  check "猶予の間は、旧IP(.12)への直接接続もまだ迂回される" '[ "$(src_of_ip 203.0.113.12)" = "$BYPASS_IP" ]'
  echo "   ... 期限（TTL5秒+猶予60秒）の経過を待つ"
  sleep 68
  check "期限を過ぎた旧IP(.12)は迂回対象から外れ、VPN出口を経由する" '[ "$(src_of_ip 203.0.113.12)" = "$VPN_IP" ]'
  check "nft setから旧IP(.12)が消えている" '! set_elements | grep -q "203.0.113.12"'
fi

if run H; then
  echo "== H: VPN未接続・Kill Switch ON"
  vpn_down
  check "VPN未接続では、迂回対象外(b.example.test)は遮断される" '[ -z "$(src_of b.example.test)" ]'
  check "VPN未接続でも、迂回対象(a.example.test)は疎通する（実回線）" '[ "$(src_of a.example.test)" = "$BYPASS_IP" ]'
  check "VPN未接続でも、名前解決の中継は動く" '[ "$(cl dig +short +time=3 +tries=1 b.example.test)" = 203.0.113.11 ]'
fi

if run I; then
  echo "== I: 上流障害"
  dnsc curl -s "http://127.0.0.1:9000/doh?state=down" >/dev/null
  check "フェイルクローズ: 上流(DoH)が失敗するとSERVFAILを返す" 'cl dig +time=3 +tries=1 z.example.test | grep -q SERVFAIL'
  check "稼働状況: upstream=failing" 'wait_for 5 "[ \"\$(gateway_field \"[\\\"dnsRelay\\\"][\\\"upstream\\\"]\")\" = failing ]"'
  cfg '{"dnsFailureMode":"fallback","dnsFallbackServers":["10.98.1.40"]}' >/dev/null; sleep 2
  dnsc curl -s http://127.0.0.1:9000/clear >/dev/null
  check "フォールバック: 公開DNS（平文）へ切り替わり、応答が返る" '[ "$(cl dig +short +time=5 +tries=1 z.example.test)" = 203.0.113.11 ]'
  check "フォールバック先（平文DNS）にはClientIDが付かず、問い合わせが平文で届く" 'dnsc curl -s http://127.0.0.1:9000/log | grep -q "^plain 10.98.1.10 z.example.test"'
  dnsc curl -s "http://127.0.0.1:9000/doh?state=up" >/dev/null
  cfg '{}' >/dev/null; sleep 2
  check "上流の復旧後、稼働状況がupstream=okに戻る" 'cl dig +short z.example.test >/dev/null; wait_for 5 "[ \"\$(gateway_field \"[\\\"dnsRelay\\\"][\\\"upstream\\\"]\")\" = ok ]"'
fi

if run J; then
  echo "== J: 53番リダイレクト"
  check "リダイレクト無効: 手動で指定した外部DNS(9.9.9.9)には、そのまま送られる（モックの名前は解決されない）" '! cl dig +short +time=3 +tries=1 @9.9.9.9 a.example.test | grep -q 203.0.113.10'
  cfg '{"dnsRedirectEnabled":true}' >/dev/null; sleep 3
  check "リダイレクト有効: 外部DNS(9.9.9.9)宛の問い合わせも中継され、モックの応答が返る" '[ "$(cl dig +short +time=3 +tries=1 @9.9.9.9 a.example.test)" = 203.0.113.10 ]'
  check "リダイレクト有効: TCPの問い合わせも中継される" '[ "$(cl dig +short +tcp +time=3 +tries=1 @9.9.9.9 a.example.test)" = 203.0.113.10 ]'
  cfg '{"dnsRedirectEnabled":true,"dnsRedirectExcludedCidrs":["9.9.9.9/32"]}' >/dev/null; sleep 3
  check "除外CIDR(9.9.9.9/32)宛は、リダイレクトされない" '! cl dig +short +time=3 +tries=1 @9.9.9.9 a.example.test | grep -q 203.0.113.10'
  cfg '{}' >/dev/null; sleep 2
fi

if run K; then
  echo "== K: 明示的プロキシ"
  vpn_up
  cfg '{"explicitProxyEnabled":true,"explicitProxyAllowedCidrs":["10.98.1.0/24"]}' >/dev/null
  wait_for 20 '[ "$(gateway_field "[\"explicitProxy\"][\"state\"]")" = active ]'
  dnsc curl -s http://127.0.0.1:9000/clear >/dev/null
  check "プロキシ経由: 迂回ドメインは実回線（接続元=ゲートウェイ自身）" '[ "$(cl curl -s -m 10 -x socks5h://$GW_LAN:1080 http://a.example.test:8080/)" = "$BYPASS_IP" ]'
  check "プロキシ経由: 迂回ドメイン以外はVPN出口を経由する" '[ "$(cl curl -s -m 10 -x socks5h://$GW_LAN:1080 http://b.example.test:8080/)" = "$VPN_IP" ]'
  check "プロキシ（HTTP）経由でも同様に迂回される" '[ "$(cl curl -s -m 10 -x http://$GW_LAN:3128 http://a.example.test:8080/)" = "$BYPASS_IP" ]'
  check "プロキシの名前解決も中継リゾルバを通り、ClientIDは explicit-proxy" 'dnsc curl -s http://127.0.0.1:9000/log | grep -q "^doh explicit-proxy a.example.test"'
  echo "-- 明示的プロキシのみ（透過ゲートウェイ無効）"
  cfg '{"explicitProxyEnabled":true,"explicitProxyAllowedCidrs":["10.98.1.0/24"],"transparentGatewayEnabled":false}' >/dev/null; sleep 4
  check "透過ゲートウェイ無効でも、nftテーブルに迂回のsetとoutputのマークがある（forwardは無い）" 'nft_dump | grep -q "chain bypass_mark_output" && ! nft_dump | grep -q "chain forward"'
  check "明示的プロキシのみでも、迂回ドメインは実回線から出る" '[ "$(cl curl -s -m 10 -x socks5h://$GW_LAN:1080 http://a.example.test:8080/)" = "$BYPASS_IP" ]'
  check "明示的プロキシのみでも、迂回ドメイン以外はVPN出口を経由する" '[ "$(cl curl -s -m 10 -x socks5h://$GW_LAN:1080 http://b.example.test:8080/)" = "$VPN_IP" ]'
  cfg '{}' >/dev/null; sleep 3
fi

if run L; then
  echo "== L: DNS中継の無効化"
  vpn_up
  cfg '{"dnsRelayEnabled":false}' >/dev/null; sleep 4
  check "稼働状況: dnsRelay.state=stopped" '[ "$(gateway_field "[\"dnsRelay\"][\"state\"]")" = stopped ]'
  check "ゲートウェイのDNS(53)が待ち受けを止める" '! gw ss -lnu "sport = :53" | grep -q "10.98.1.10:53"'
  check "nftテーブルから迂回のset・マークが消える" '! nft_dump | grep -q "bypass"'
  check "ip rule（fwmark 0x100）が撤去される" '! gw ip -4 rule show | grep -q "fwmark 0x100"'
  check "テーブル100の経路が空になる" '[ -z "$(gw ip -4 route show table 100)" ]'
  check "透過ゲートウェイは影響なく、VPN出口を経由して通信できる" '[ "$(src_of_ip 203.0.113.11)" = "$VPN_IP" ]'
  cfg '{}' >/dev/null; sleep 3
  check "再度有効にすると、待受と迂回が復旧する" '[ "$(gateway_field "[\"dnsRelay\"][\"state\"]")" = active ] && [ "$(src_of a.example.test)" = "$BYPASS_IP" ]'
fi

if run M; then
  echo "== M: 待受の失敗と回復（53番ポートが使用中）"
  vpn_up
  cfg '{"dnsRelayEnabled":false}' >/dev/null; sleep 3
  # ゲートウェイ役で53番（UDP・TCP）を先に占有する
  gw sh -c 'nohup python3 -c "
import socket,time
u=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); u.bind((\"10.98.1.10\",53))
t=socket.socket(); t.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); t.bind((\"10.98.1.10\",53)); t.listen(1)
time.sleep(600)" >/dev/null 2>&1 &'
  sleep 1
  cfg '{"dnsRedirectEnabled":true}' >/dev/null; sleep 4
  check "稼働状況: dnsRelay.state=error（待受に失敗）" '[ "$(gateway_field "[\"dnsRelay\"][\"state\"]")" = error ]'
  check "待受に失敗している間は、53番リダイレクトを入れない（手動でDNSを指定した端末の名前解決を止めない）" '! nft_dump | grep -q "dns_redirect"'
  gw pkill -f "import socket,time"
  check "ポートの占有が解消すると、再通知（10秒周期）で待受が回復してactiveになる" 'wait_for 30 "[ \"\$(gateway_field \"[\\\"dnsRelay\\\"][\\\"state\\\"]\")\" = active ]"'
  check "回復後、53番リダイレクトが入る" 'wait_for 15 "nft_dump | grep -q dns_redirect"'
  cfg '{}' >/dev/null; sleep 2
fi

echo "== 後始末: VPN切断・設定を初期化"
gw ip route replace default via 10.98.1.1 dev eth0
cfg '{"dnsRelayEnabled":false,"excludedDomains":[]}' >/dev/null
reset_operator_account
echo "== 結果: FAIL $FAILS 件"
exit "$FAILS"
