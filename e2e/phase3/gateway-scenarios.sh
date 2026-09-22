#!/bin/bash
# 責務: Phase 3完了基準（wbs/phase3.md）を、LXC検証環境（e2e/lxc/setup.sh・sync.sh構築済み）上で
# 自動検証する。ゲートウェイ役コンテナでdocker compose（web/api/proxy）を動かし、LAN端末役コンテナの
# デフォルトゲートウェイをそれに向けて、実VPN（AdGuard VPN CLI）経由の通信・Kill Switch・再起動冪等性を確認する。
# Web UI操作はPlaywright（同ディレクトリの*.mjs）で行い、通信結果の確認はLAN端末役からのcurlで行う。
#
# 前提: 実VPNベンダーへのログインが完了していること（未ログインだとVPN必要シナリオ(C)が失敗する）。
# 実行: [GW_MODE=ssh] bash e2e/phase3/gateway-scenarios.sh [A|B|C|D|E|F|G|H ...]  ※省略時は全シナリオ
#   （GW_MODE=ssh: 実機ゲートウェイへSSH接続して検証。省略時はLXC内ゲートウェイ。lxc/env.sh参照）
#   A: 静的前提（インストールスクリプト・sysctl・.env・sudo nft）
#   B: VPN不要（透過GW OFF/ON、Kill Switch ON=遮断/OFF=フェイルオープン、Web UI到達性）
#   C: VPN必要（接続→VPN経由通信、切断/瞬断→Kill Switch、国変更、KS OFF→直接）
#   D: proxy再起動後のnftルール冪等性・ip_forwardフォールバック
#   E: 同居Dockerコンテナの通信が遮断されない（KS ON・VPN未接続/接続中）
#   F: IPv6リークの実測（IPv4のみ対象であることの確認。結果はINFO表示）
#   G: 上流断（物理NIC上のインターネット向け通信の途絶）でリークせず、復旧後に回復する（実機のみ）
#   H: ホスト再起動（restart: alwaysによる自動復帰・起動途中のリーク窓の実測。実機のみ）
# 出力: 各検証を PASS/FAIL で表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$HERE/../lxc/env.sh"
. "$HERE/../lib/gw.sh"
# ゲートウェイ側のLAN側NIC名（LXC内GWはeth0、実機は例えばenp6s18）
LAN_IF=$GW_LAN_IF
# LAN側NICのIPv4アドレスを直接取得する（`lxc list`はdockerブリッジ等の複数IPを返すため使わない）
GW_IP=$(gw_lan_ip)
CLIENT_IP=$(lxc exec "$CLIENT_NAME" -- ip -4 -o addr show eth0 | awk '{sub("/.*","",$4); print $4}')
BASE="http://$GW_IP:8080"
FAILS=0
# VPN接続のE2Eに使う国（ISO国コード）。検証環境のLAN出口IPと出口IPが一致する接続先（例: 環境によりjpのTokyo）を避けるため、既定はus。
VPN_COUNTRY=${VPN_COUNTRY:-us}

client()  { lxc exec "$CLIENT_NAME" -- "$@"; }
proxy_sh(){ gw docker compose exec -T proxy sh -c "$1"; }
# ベンダーCLI（VPNデーモン）はPhase 8以降、ネットワークコンテナ（proxy）ではなくランナー（runner-adguardvpn）内で動く。
runner_sh(){ gw docker compose exec -T runner-adguardvpn sh -c "$1"; }
ok()      { echo "PASS: $1"; }
ng()      { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
check()   { if eval "$2"; then ok "$1"; else ng "$1"; fi; }
gui()     { node "$HERE/$1" "$BASE" "${@:2}" || FAILS=$((FAILS+1)); }
# LAN端末役から見た外部IP（取得不能なら空）
client_ip() { client curl -s -m 8 https://api.ipify.org 2>/dev/null; }
# GW自身の（コンテナ外側から見た）外部IP
gw_ip()     { gw curl -s -m 8 https://api.ipify.org 2>/dev/null; }
# 条件が真になるまで最大N秒ポーリングする（例: wait_for 20 'cmd'）
wait_for()  { local n=$1; shift; for _ in $(seq "$n"); do if eval "$1"; then return 0; fi; sleep 1; done; return 1; }
# 前のシナリオから接続状態が持ち越されないよう、APIで切断状態に揃える（Web UIの検証対象は本操作ではない）
reset_vpn() { gw curl -s -X PUT localhost:8080/api/v1/connection -H 'Content-Type: application/json' -d '{"connect":false}' >/dev/null; sleep 2; }
# nftのforwardチェーンにVPN経由acceptがあるか
has_vpn_rule() { gw nft list table inet vpngwgui 2>/dev/null | grep -q 'oifname "tun[0-9]*" accept'; }

scenario_A() {
  echo "=== A: 静的前提 ==="
  check "install/install.sh が作る sysctl 設定が存在する" 'gw grep -q "net.ipv4.ip_forward=1" /etc/sysctl.d/99-vpngwgui.conf'
  check ".env に LAN_IFACE が書き出されている" 'gw grep -q "^LAN_IFACE=$LAN_IF$" .env'
  check "proxyコンテナが network_mode: host（コンテナ内のIFにLAN側NICが見える）" 'proxy_sh "ip -o link show $LAN_IF" >/dev/null'
  check "install/install.sh の起動ガード(systemd)が有効化されている" 'gw systemctl is-enabled vpngwgui-boot-guard.service | grep -q enabled'
  check "proxyの非rootユーザー(vpngwgui)から sudo nft が実行できる" 'proxy_sh "id -un | grep -q vpngwgui && sudo nft list ruleset >/dev/null"'
  check "proxyコンテナ内の iproute2 の ip route show default が実行できる" 'proxy_sh "ip route show default | grep -q default"'
}

scenario_B() {
  echo "=== B: VPN不要シナリオ ==="
  gui webgui-settings.mjs on on
  check "透過GW ON: inet vpngwgui テーブルが存在し、LAN側発のforwardをdropするルールがある" 'gw nft list table inet vpngwgui | grep -q "iifname \"$LAN_IF\" drop"'
  check "KS ON・VPN未接続: LAN端末の外部通信が遮断される（フェイルクローズ）" '[ -z "$(client_ip)" ]'
  check "KS ON・VPN未接続でもLAN端末からWeb UIへ到達できる" '[ "$(client curl -s -m 5 -o /dev/null -w %{http_code} $BASE/)" = 200 ]'
  gui webgui-settings.mjs on off
  BASE_IP=$(gw_ip)
  check "KS OFF・VPN未接続: LAN端末の通信がGW経由で直接インターネットへ抜ける（フェイルオープン）" '[ "$(client_ip)" = "$BASE_IP" ] && [ -n "$BASE_IP" ]'
  check "GWのforward/postroutingにフェイルオープン用ルール(masquerade)がある" 'gw nft list table inet vpngwgui | grep -q "oifname \"$LAN_IF\" masquerade"'
  # GWのICMP(time-exceeded)応答にはレート制限があり、直前の通信の直後は応答が返らないことがあるため、
  # 1秒間隔で最大10回リトライし、1ホップ目にGWのIPが現れれば合格とする
  check "LAN端末のtracerouteの1ホップ目がGWである（実際にGW経由）" 'wait_for 10 "client traceroute -n -m 1 -q 1 -w 1 1.1.1.1 2>/dev/null | grep -q \"$GW_IP\""'
  gui webgui-settings.mjs off off
  check "透過GW OFF: inet vpngwgui テーブルが撤去される" '! gw nft list table inet vpngwgui >/dev/null 2>&1'
}

scenario_C() {
  echo "=== C: VPN必要シナリオ（実VPN） ==="
  reset_vpn
  gui webgui-settings.mjs on on
  BASE_IP=$(gw_ip)
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  check "接続後: 公開IP宛の経路(ip route get)が tun 系インターフェースを指す（実CLIはポリシールーティング）" 'proxy_sh "ip route get 1.1.1.1" | grep -q "dev tun"'
  check "接続後: nftに tun経由のmasquerade/forward acceptルールが動的に入る" 'has_vpn_rule && gw nft list table inet vpngwgui | grep -q "oifname \"tun[0-9]*\" masquerade"'
  VPN_IP=$(client_ip)
  check "接続後: LAN端末の外部IPがVPN経由のIP（GW直接のIPと異なる）になる" '[ -n "$VPN_IP" ] && [ "$VPN_IP" != "$BASE_IP" ]'
  echo "  (baseline=$BASE_IP vpn=$VPN_IP)"
  # VPN接続中はポリシールーティング（ip rule）が全通信をトンネルへ向けるため、Web UIの応答がトンネルへ
  # 流れてしまわないか（LANから管理画面へ到達できなくなる不具合が起きないか）を確認する
  check "接続中でもLAN端末からWeb UIへ到達できる" '[ "$(client curl -s -m 5 -o /dev/null -w %{http_code} $BASE/)" = 200 ]'

  # 切断（disconnect）→ KS ON なので遮断
  gui webgui-connection.mjs disconnect
  check "切断後(KS ON): tun向けacceptルールが即時撤去される" '! has_vpn_rule'
  check "切断後(KS ON): LAN端末の外部通信が遮断される" '[ -z "$(client_ip)" ]'

  # 再接続 → 瞬断（VPNデーモンをkill）→ KS ON なので遮断（監視ループによる検知）
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  check "再接続後: LAN端末がVPN経由で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'
  runner_sh "sudo pkill -9 -f adguardvpn-cli; sleep 1; sudo ip link del tun0 2>/dev/null; true"
  check "瞬断(KS ON): 監視ループ(10秒周期)内にVPN向けacceptルールが撤去される" 'wait_for 15 "! has_vpn_rule"'
  check "瞬断(KS ON): LAN端末の外部通信が遮断される（リークしない）" '[ -z "$(client_ip)" ]'

  # KS OFF → 切断状態でフェイルオープン
  gui webgui-settings.mjs on off
  check "瞬断状態(KS OFF): 直接インターネットへ抜ける（フェイルオープン）" '[ "$(client_ip)" = "$BASE_IP" ]'

  # 国変更: 別国へ接続し直し、新しいトンネルでルールが再適用される
  gui webgui-settings.mjs on on
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  JP_IP=$(client_ip)
  gui webgui-connection.mjs disconnect
  gui webgui-connection.mjs connect de
  wait_for 20 has_vpn_rule
  DE_IP=$(client_ip)
  echo "  (jp=$JP_IP de=$DE_IP)"
  check "国変更後: 新しい接続国でLAN端末が通信でき、IPが変わる" '[ -n "$DE_IP" ] && [ "$DE_IP" != "$JP_IP" ] && [ "$DE_IP" != "$BASE_IP" ]'
  check "国変更後: nftのVPNルールが重複していない（tun向けmasqueradeは1行）" '[ "$(gw nft list table inet vpngwgui | grep -c "oifname \"tun[0-9]*\" masquerade")" = 1 ]'
}

scenario_D() {
  echo "=== D: 再起動・冪等性 ==="
  reset_vpn
  gui webgui-settings.mjs on on
  BASE_IP=$(gw_ip)
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  check "前提: VPN接続中・KS ONでLAN端末がVPN経由で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'

  # D1: proxyコンテナ（ネットワーク）とランナーのみ再起動（APIは動き続ける）。VPNデーモンはランナー内のため落ちる
  # （Phase 9まではproxyコンテナ1つの再起動で同じ状況になった。Phase 8以降はネットワークコンテナとランナーの両方を再起動して再現する）。
  # 再起動中・直後にKS ONのままリークしない（実IPが見えない）ことを、複数回サンプリングして確認する。
  gw docker compose restart proxy runner-adguardvpn >/dev/null 2>&1
  LEAK=0
  for _ in $(seq 12); do
    ip=$(client_ip)
    if [ -n "$ip" ] && [ "$ip" = "$BASE_IP" ]; then LEAK=1; fi
    sleep 1
  done
  check "proxyのみ再起動: 再起動直後〜復旧までの間、KS ONでLAN端末の通信が実IPへリークしない" '[ "$LEAK" = 0 ]'
  check "proxyのみ再起動: inet vpngwgui テーブルが撤去されず存在し続ける（KSルールの維持）" 'gw nft list table inet vpngwgui >/dev/null 2>&1'
  # APIの定期再通知（10秒周期）で設定が再pushされ、ルールが全再構成されること
  check "proxyのみ再起動: API定期再通知後もテーブルは1つだけ（重複なし）" '[ "$(gw nft list tables | grep -c "inet vpngwgui")" = 1 ]'

  # D2: 残骸ルールを混入してからスタック全体を再起動し、正規のルールのみに再構成されること
  gw nft add rule inet vpngwgui forward iifname "$LAN_IF" oifname "$LAN_IF" tcp dport 65000 accept
  check "前提: 残骸ルール(dport 65000)を混入した" 'gw nft list table inet vpngwgui | grep -q 65000'
  gw docker compose restart >/dev/null 2>&1
  check "スタック全体再起動: 残骸ルールが再構成で掃除される" 'wait_for 40 "! gw nft list table inet vpngwgui 2>/dev/null | grep -q 65000 && gw nft list table inet vpngwgui >/dev/null 2>&1"'
  check "スタック全体再起動: inet vpngwgui テーブルが1つだけ存在する" '[ "$(gw nft list tables | grep -c "inet vpngwgui")" = 1 ]'
  check "スタック全体再起動: forwardチェーンが正規構成（VPN未接続・KS ON: LAN発のインターフェース間acceptが無い）" '[ "$(gw nft list chain inet vpngwgui forward | grep -c "iifname \"$LAN_IF\" oifname")" = 0 ] && gw nft list chain inet vpngwgui forward | grep -q "iifname \"$LAN_IF\" drop"'

  # D3: ip_forward=0のままproxyを起動 → Dockerの/proc/sys読み取り専用で補正できないため、警告が監査ログに残ること
  gw sysctl -w net.ipv4.ip_forward=0 >/dev/null
  gw docker compose restart proxy >/dev/null 2>&1
  sleep 4
  check "ip_forward=0でproxy起動: 補正不能を検知し ip_forward_disabled 警告が監査ログに残る" 'gw docker compose logs proxy 2>/dev/null | grep -q "ip_forward_disabled"'
  gw sysctl -w net.ipv4.ip_forward=1 >/dev/null
}

# 同居Dockerコンテナ（ゲートウェイ機能と無関係）のインターネット向け通信の外部IPを取得する
docker_ip() { gw docker run --rm curlimages/curl -s -m 10 https://api.ipify.org 2>/dev/null; }
# IPv6の外部アドレス（LAN端末発）。GWを経由しない通信のため、リークの実態を見る目的で使う
client_ip6() { client curl -6 -s -m 8 https://api64.ipify.org 2>/dev/null; }

scenario_E() {
  echo "=== E: 同居Dockerコンテナへの影響 ==="
  reset_vpn
  gui webgui-settings.mjs on on
  BASE_IP=$(gw_ip)
  gw docker pull -q curlimages/curl >/dev/null 2>&1
  check "KS ON・VPN未接続: 同居Dockerコンテナのインターネット通信は遮断されない（LAN端末は遮断される）" '[ "$(docker_ip)" = "$BASE_IP" ] && [ -z "$(client_ip)" ]'
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  check "VPN接続中: 同居Dockerコンテナの通信も正常（通信経路はホストの経路に従う）" '[ -n "$(docker_ip)" ]'
  check "VPN接続中: LAN端末はVPN経由で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'
  reset_vpn
}

scenario_F() {
  echo "=== F: IPv6リークの実測（透過GWはIPv4のみ対象） ==="
  reset_vpn
  gui webgui-settings.mjs on on
  BASE_IP=$(gw_ip)
  V6_OFF=$(client_ip6)
  echo "INFO: KS ON・VPN未接続でのLAN端末のIPv6外部アドレス: '${V6_OFF:-(取得不能)}'（IPv4は遮断: '$(client_ip)'）"
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  V6_ON=$(client_ip6)
  echo "INFO: VPN接続中(IPv4=$(client_ip))でのLAN端末のIPv6外部アドレス: '${V6_ON:-(取得不能)}'"
  check "IPv4は遮断/VPN経由になっている一方、IPv6はGWを経由せずルータ直で通信できる（既知の制約: IPv4のみ対象）" '[ -n "$V6_OFF" ] && [ "$V6_OFF" = "$V6_ON" ]'
  reset_vpn
}

scenario_G() {
  [ "$GW_MODE" = ssh ] || { echo "=== G: スキップ（実機のみ） ==="; return; }
  echo "=== G: 上流断（物理NICのインターネット向け通信を遮断） ==="
  reset_vpn
  gui webgui-settings.mjs on on
  BASE_IP=$(gw_ip)
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  check "前提: VPN接続中でLAN端末がVPN経由で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'
  # ホスト自身の送信（VPNデーモンの外側トンネル通信）のうち、LAN外向けをNIC上で落として上流断を模擬する。
  # SSH（ホストの管理通信）は同一LAN(192.168.0.0/16)宛のため影響を受けない。
  gw nft add table inet e2eblackhole
  gw nft "add chain inet e2eblackhole out { type filter hook output priority 0 ; }"
  gw nft "add rule inet e2eblackhole out oifname \"$LAN_IF\" ip daddr != 192.168.0.0/16 drop"
  LEAK=0; for _ in $(seq 20); do ip=$(client_ip); [ -n "$ip" ] && [ "$ip" = "$BASE_IP" ] && LEAK=1; sleep 1; done
  check "上流断の間、LAN端末の通信が実IPへリークしない" '[ "$LEAK" = 0 ]'
  check "上流断の間もKill Switch/透過GWのルールが維持される（LAN発のforward dropがある）" 'gw nft list table inet vpngwgui | grep -q "iifname \"$LAN_IF\" drop"'
  gw nft delete table inet e2eblackhole
  # 復旧: VPN CLIが自動再接続するか（しない場合は手動再接続が必要＝KSにより遮断されたまま）を実測する
  if wait_for 90 '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'; then
    echo "INFO: 上流復旧後、VPNは自動的に回復した"
  else
    echo "INFO: 上流復旧後90秒経ってもVPNは自動回復せず（KSにより遮断のまま）。手動での再接続が必要"
  fi
  reset_vpn
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  check "手動再接続後: LAN端末がVPN経由で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'
  reset_vpn
}

scenario_H() {
  [ "$GW_MODE" = ssh ] || { echo "=== H: スキップ（実機のみ） ==="; return; }
  echo "=== H: ホスト再起動 ==="
  reset_vpn
  gui webgui-settings.mjs on on
  BASE_IP=$(gw_ip)
  gui webgui-connection.mjs connect "$VPN_COUNTRY"
  wait_for 20 has_vpn_rule
  check "前提: VPN接続中でLAN端末がVPN経由で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'
  # 再起動を開始し、LAN端末から1秒間隔で外部IPをサンプリングして、実IPが見えた（=リークした）回数を数える
  gw sh -c 'nohup sh -c "sleep 2; reboot" >/dev/null 2>&1 &' 
  LEAK=0; UP=0; STACK_AT=""
  for t in $(seq 240); do
    ip=$(client_ip)
    [ -n "$ip" ] && [ "$ip" = "$BASE_IP" ] && LEAK=$((LEAK+1))
    if [ -z "$STACK_AT" ] && [ "$t" -gt 10 ] && gw nft list table inet vpngwgui >/dev/null 2>&1; then STACK_AT=$t; fi
    [ -n "$STACK_AT" ] && [ "$t" -gt $((STACK_AT+15)) ] && break
    sleep 1
  done
  echo "INFO: 再起動後、nftテーブルが確認できたのは開始から約${STACK_AT:-（未確認）}秒後。この間の実IPリーク観測回数: $LEAK"
  check "再起動後: restart: always によりweb/api/proxyが自動起動する" 'wait_for 60 "[ \"$(gw docker compose ps --format {{.State}} | grep -c running)\" = 3 ]"'
  check "再起動後: inet vpngwgui テーブルが構成され、VPN未接続のためLAN端末の通信は遮断される（KS ON）" 'wait_for 60 "gw nft list table inet vpngwgui >/dev/null 2>&1" && [ -z "$(client_ip)" ]'
  check "再起動中〜復旧までにKill Switch ONのLAN端末通信がリークしない（実IPが観測されない）" '[ "$LEAK" = 0 ]'
  check "再起動後: 起動ガード(vpngwgui-boot-guard.service)が実行された" 'gw systemctl is-active vpngwgui-boot-guard.service | grep -q active'
  check "再起動後: ip_forward が永続設定により1である" '[ "$(gw cat /proc/sys/net/ipv4/ip_forward)" = 1 ]'
  reset_vpn
}

# LAN端末のデフォルトゲートウェイがGWだけであることを保証する（DHCP由来のルートが混在していると、
# GWを迂回した通信で検証が進み、結果が無効になるため、検証開始前に必ず確認する）。
ensure_client_route() {
  client sh -c "ip route | awk '/^default/ && !/via $GW_IP /{print \$0}' | while read r; do ip route del \$r; done; ip route replace default via $GW_IP"
  local n; n=$(client ip route show default | wc -l)
  if [ "$n" != 1 ] || ! client ip route show default | grep -q "via $GW_IP "; then
    echo "FAIL: LAN端末のデフォルトゲートウェイがGWのみになっていない（検証前提が不成立）"; exit 99
  fi
}
ensure_client_route

SELECTED=("$@"); [ ${#SELECTED[@]} -eq 0 ] && SELECTED=(A B C D E F G H)
for s in "${SELECTED[@]}"; do "scenario_$s"; done
echo "=== FAIL件数: $FAILS ==="
exit $FAILS
