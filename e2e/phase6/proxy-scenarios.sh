#!/bin/bash
# 責務: Phase 6完了基準を、実VPNログイン済みのゲートウェイ役（e2e/lxc/sync.sh構築済み）と、
# 実LANのLAN端末役（macvlan LXCコンテナ。CLIENT_NAME）から、SOCKS5/HTTPプロキシとして通信して検証する。
# 実行: [GW_MODE=ssh] bash e2e/phase6/proxy-scenarios.sh [A|B|C|D|E|F|G ...]  ※省略時は全シナリオ
#   A: 許可CIDR内のクライアントがSOCKS5/HTTP(HTTPS CONNECT含む)で通信でき、許可CIDR外は拒否される
#   B: 無効化でプロセスが停止しポートが閉じる／再有効化で再度listenする。許可CIDR空は起動しない。不正CIDRは400
#   C: 3proxyを強制終了(kill -9)すると自動再起動する。連続すると指数バックオフ→crashLoop報告→安定後に回復
#   D: VPN接続・切断・国変更で3proxyは再起動されず（PID不変）、VPN接続中は出口IPがVPN側になる
#   E: 同一設定の再通知（APIの定期再通知）や透過ゲートウェイの設定変更で3proxyが再起動されない
#   F: Web UI（Playwright）からの有効化・CIDR保存・状態表示・無効化
#   H: proxyコンテナの再起動後、APIの設定再通知（10秒周期）で3proxyが自動復帰する
#   G: 既知の制約の実測（INFO表示のみ。VPN未接続時は明示的プロキシがKill Switchの対象外で直接抜ける）
# 前提: 実VPNベンダーへのログイン済み。開始時に透過ゲートウェイON・Kill Switch ON・VPN切断・明示的プロキシ無効へ
#       初期化する（設定を書き換えるため検証専用環境で実行すること）。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$HERE/../lxc/env.sh"
. "$HERE/../lib/gw.sh"
. "$HERE/../lib/api-auth.sh"
GW_IP=$(gw_lan_ip)
BASE="http://$GW_IP:8080"
e2e_api_login "$BASE"
SOCKS_PORT=1080
HTTP_PORT=3128
FAILS=0

client() { lxc exec "$CLIENT_NAME" -- "$@"; }
CLIENT_IP=$(client ip -4 -o addr show eth0 | awk '{sub("/.*","",$4); print $4}' | head -n1)
# クライアントのIPを含む許可CIDR（/24）、および含まない許可CIDR（クライアントと別の/24。到達性には無関係）
ALLOW_CIDR="${CLIENT_IP%.*}.0/24"
DENY_CIDR="10.99.0.0/24"

ok()    { echo "PASS: $1"; }
ng()    { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
check() { if eval "$2"; then ok "$1"; else ng "$1"; fi; }
gui()   { node "$HERE/webgui-explicit-proxy.mjs" "$BASE" "$@" || FAILS=$((FAILS+1)); }
api()   { curl -s -m 60 -b "$E2E_COOKIE_JAR" -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "$BASE/api$2"; }
wait_for() { local n=$1; shift; for _ in $(seq "$n"); do if eval "$1"; then return 0; fi; sleep 1; done; return 1; }
# LAN端末役から見た、プロキシ経由の外部IP（取得不能なら空）
via_socks() { client curl -s -m 15 -x "socks5h://$GW_IP:$SOCKS_PORT" https://api.ipify.org 2>/dev/null; }
via_http()  { client curl -s -m 15 -x "http://$GW_IP:$HTTP_PORT" https://api.ipify.org 2>/dev/null; }
via_http_plain() { client curl -s -m 15 -x "http://$GW_IP:$HTTP_PORT" http://api.ipify.org 2>/dev/null; }
# 標準入力がIPv4アドレス1つだけか（プロキシが拒否時に返す403等のエラーページ本文と区別するため）
is_ip() { grep -Eq '^[0-9]+(\.[0-9]+){3}$'; }
# GW自身の外部IP（VPN未接続時は実回線の出口。LAN端末役自身の直接通信は、透過ゲートウェイ+Kill Switch ONでは
# VPN未接続時に遮断されるため使えない）
direct_ip() { gw curl -s -m 10 https://api.ipify.org 2>/dev/null; }
explicit_state() { api GET /v1/connection/gateway | python3 -c "import json,sys;print(json.load(sys.stdin)['explicitProxy']['state'])" 2>/dev/null; }
restart_count() { api GET /v1/connection/gateway | python3 -c "import json,sys;print(json.load(sys.stdin)['explicitProxy']['restartCount'])" 2>/dev/null; }
# proxyコンテナ内の3proxyのPID（不在なら空）
proxy_pid() { gw docker compose exec -T proxy sh -c 'pidof 3proxy' 2>/dev/null | tr -d '\r' | awk '{print $1}'; }
# ホスト上で指定ポートがlistenされているか
listening() { gw ss -ltn "sport = :$1" | grep -q LISTEN; }
set_proxy() { api PUT /v1/connection/config "{\"explicitProxyEnabled\":$1,\"explicitProxyAllowedCidrs\":$2}" >/dev/null; }

echo "== 準備: 透過ゲートウェイON・Kill Switch ON・VPN切断・明示的プロキシ無効（クライアント $CLIENT_IP、許可CIDR $ALLOW_CIDR）"
api PUT /v1/connection/config '{"transparentGatewayEnabled":true,"killSwitch":true}' >/dev/null
api PUT /v1/connection '{"connect":false}' >/dev/null
set_proxy false '[]'
wait_for 20 '! listening $SOCKS_PORT'

scenario_A() {
  echo "=== A: 許可CIDR内は通信でき、許可CIDR外は拒否される ==="
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 20 'listening $SOCKS_PORT && listening $HTTP_PORT'
  check "有効化でSOCKS5($SOCKS_PORT)・HTTP($HTTP_PORT)がLAN側でlistenされる" 'listening $SOCKS_PORT && listening $HTTP_PORT'
  check "GET /v1/connection/gateway の explicitProxy が active（ポート付き）" '[ "$(api GET /v1/connection/gateway | python3 -c "import json,sys;e=json.load(sys.stdin)[\"explicitProxy\"];print(e[\"state\"],e[\"socksPort\"],e[\"httpPort\"])")" = "active $SOCKS_PORT $HTTP_PORT" ]'
  local expected; expected=$(direct_ip)
  check "許可CIDR内: SOCKS5でHTTPS通信できる（VPN未接続のため出口は直接=$expected）" '[ -n "$expected" ] && [ "$(via_socks)" = "$expected" ]'
  check "許可CIDR内: HTTP CONNECT(HTTPS)で通信できる" '[ "$(via_http)" = "$expected" ]'
  check "許可CIDR内: HTTPプロキシ(平文HTTP)で通信できる" '[ "$(via_http_plain)" = "$expected" ]'

  set_proxy true "[\"$DENY_CIDR\"]"
  # 設定変更による再起動（旧プロセスの終了は約5秒）を待つ
  wait_for 30 '[ "$(client curl -s -m 5 -o /dev/null -w %{http_code} -x http://$GW_IP:$HTTP_PORT http://api.ipify.org)" != 200 ] && [ "$(explicit_state)" = active ] && listening $SOCKS_PORT'
  check "許可CIDR外: SOCKS5は拒否される" '! via_socks | is_ip'
  check "許可CIDR外: HTTP CONNECTは拒否される" '! via_http | is_ip'
  check "許可CIDR外: 平文HTTPも拒否される（エラーページのみで、出口IPは返らない）" '! via_http_plain | is_ip'
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 30 "via_socks | is_ip"
  check "許可CIDRへ戻すと再び通信できる（CIDR変更が反映される）" "via_socks | is_ip"
}

scenario_B() {
  echo "=== B: 有効/無効切替・未構成・不正CIDR ==="
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 20 'listening $SOCKS_PORT'
  set_proxy false "[\"$ALLOW_CIDR\"]"
  # 3proxyはSIGTERMから終了まで約5秒かかる
  check "無効化で3proxyプロセスが停止しポートが閉じる" 'wait_for 20 "! listening $SOCKS_PORT && ! listening $HTTP_PORT && [ -z \"\$(proxy_pid)\" ]"'
  check "無効化後の状態は stopped" '[ "$(explicit_state)" = stopped ]'
  check "無効化後、クライアントのプロキシ接続は失敗する" '[ -z "$(via_socks)" ]'
  set_proxy true "[\"$ALLOW_CIDR\"]"
  check "再有効化で再度listenする" 'wait_for 20 "listening $SOCKS_PORT && listening $HTTP_PORT"'
  set_proxy true '[]'
  check "有効でも許可CIDRが空なら停止し、状態は unconfigured（全許可・全拒否のどちらでも起動しない）" 'wait_for 20 "[ \"\$(explicit_state)\" = unconfigured ] && ! listening $SOCKS_PORT"'
  check "不正なCIDR（設定行の注入を含む）のPUTは400で拒否される" 'curl -s -m 10 -b "$E2E_COOKIE_JAR" -o /dev/null -w "%{http_code}" -X PUT -H "content-type: application/json" -d "{\"explicitProxyAllowedCidrs\":[\"192.168.3.0/24\\nallow * 0.0.0.0/0\"]}" $BASE/api/v1/connection/config | grep -q 400'
  check "不正なCIDR（プレフィックス長なし）のPUTは400で拒否される" 'curl -s -m 10 -b "$E2E_COOKIE_JAR" -o /dev/null -w "%{http_code}" -X PUT -H "content-type: application/json" -d "{\"explicitProxyAllowedCidrs\":[\"192.168.3.5\"]}" $BASE/api/v1/connection/config | grep -q 400'
  check "拒否された不正値は保存されていない" '! api GET /v1/connection/config | grep -q "192.168.3.5"'
}

scenario_C() {
  echo "=== C: 強制終了時の自動再起動・指数バックオフ・crashLoop ==="
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 20 'listening $SOCKS_PORT'
  sleep 35   # 直前のクラッシュ履歴・安定稼働タイマーの影響を残さない
  local before_pid before_count
  before_pid=$(proxy_pid); before_count=$(restart_count)
  gw docker compose exec -T proxy sh -c 'pkill -9 3proxy'
  check "kill -9 後、自動再起動して別PIDで再びlistenする" 'wait_for 15 "[ -n \"\$(proxy_pid)\" ] && [ \"\$(proxy_pid)\" != \"$before_pid\" ] && listening $SOCKS_PORT"'
  check "再起動後、プロキシ通信が再び成功する" 'wait_for 10 "[ -n \"\$(via_socks)\" ]"'
  check "restartCount が1増える" '[ "$(restart_count)" = "$((before_count+1))" ]'
  check "1回の異常終了では crashLoop にならない（active）" '[ "$(explicit_state)" = active ]'

  # 連続kill: 再起動のたびにkillし、バックオフ（1s→2s→…）と3連続でのcrashLoop報告を確認する
  for _ in 1 2 3; do
    wait_for 15 '[ -n "$(proxy_pid)" ]'
    gw docker compose exec -T proxy sh -c 'pkill -9 3proxy'
    sleep 1
  done
  check "短時間に異常終了を繰り返すと crashLoop を報告する" 'wait_for 10 "[ \"\$(explicit_state)\" = crashLoop ]"'
  # crashLoopの報告は、最後の再起動から安定稼働時間(30秒)が経つまでの間だけ続く。時間切れにならないよう先にWeb UIを確認する。
  echo "INFO: crashLoop報告開始 $(date +%T) / 状態=$(explicit_state)"
  gui crashloop
  echo "INFO: Web UI確認後 $(date +%T) / 状態=$(explicit_state)"
  check "crashLoop中も監査ログに explicit_proxy_crash_loop が残る" 'gw docker compose logs --no-log-prefix --since 2m proxy | grep -q explicit_proxy_crash_loop'
  check "crashLoop中でも再起動を試み続け、プロセスが復帰する" 'wait_for 30 "[ -n \"\$(proxy_pid)\" ] && listening $SOCKS_PORT"'
  check "安定稼働（30秒）後に crashLoop が解消して active に戻る" 'wait_for 50 "[ \"\$(explicit_state)\" = active ]"'
}

scenario_D() {
  echo "=== D: VPN接続状態の変化と独立して動作する ==="
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 20 'listening $SOCKS_PORT'
  sleep 2
  local pid direct vpn_ip
  pid=$(proxy_pid); direct=$(direct_ip)
  # 検証環境ではjp-tokyoの出口IPがLANの直接の出口IPと一致するため、最初の接続にはus-las-vegasを使い、国変更でjp-tokyoへ変える。
  api PUT /v1/connection '{"connect":true,"locationId":"us-las-vegas"}' >/dev/null
  wait_for 30 'api GET /v1/connection | grep -q "\"status\":\"connected\""'
  sleep 3
  vpn_ip=$(via_socks)
  check "VPN接続中: SOCKS5の出口IPがVPN側になる（直接=$direct、プロキシ経由=$vpn_ip）" '[ -n "$vpn_ip" ] && [ "$vpn_ip" != "$direct" ]'
  check "VPN接続中: HTTP CONNECTの出口IPもVPN側になる" '[ "$(via_http)" = "$vpn_ip" ]'
  check "VPN接続で3proxyが再起動されない（PID不変）" '[ "$(proxy_pid)" = "$pid" ]'
  api PUT /v1/connection '{"connect":true,"locationId":"jp-tokyo"}' >/dev/null
  wait_for 30 'api GET /v1/connection | grep -q "jp-tokyo"'
  sleep 3
  check "国変更（再接続）で3proxyが再起動されず、出口IPが変わる" '[ "$(proxy_pid)" = "$pid" ] && [ -n "$(via_socks)" ] && [ "$(via_socks)" != "$vpn_ip" ]'
  api PUT /v1/connection '{"connect":false}' >/dev/null
  sleep 4
  check "VPN切断で3proxyが再起動されない（PID不変・稼働継続）" '[ "$(proxy_pid)" = "$pid" ] && [ "$(explicit_state)" = active ]'
  check "透過ゲートウェイ（nft）とプロキシが同居して稼働している（nftテーブルが存在）" 'gw nft list table inet vpngwgui >/dev/null'
}

scenario_E() {
  echo "=== E: 不要な再起動をしない（定期再通知・無関係な設定変更） ==="
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 20 'listening $SOCKS_PORT'
  sleep 2
  local pid; pid=$(proxy_pid)
  sleep 25   # APIの設定再通知（10秒周期）を複数回またぐ
  check "APIの定期再通知（設定変更なし）で再起動されない" '[ "$(proxy_pid)" = "$pid" ]'
  api PUT /v1/connection/config '{"killSwitch":false}' >/dev/null
  sleep 3
  api PUT /v1/connection/config '{"killSwitch":true,"transparentGatewayEnabled":false}' >/dev/null
  sleep 3
  api PUT /v1/connection/config '{"transparentGatewayEnabled":true}' >/dev/null
  sleep 3
  check "Kill Switch・透過ゲートウェイの設定変更で3proxyが再起動されない" '[ "$(proxy_pid)" = "$pid" ]'
  check "同一CIDRでのPUT（実質変更なし）でも再起動されない" 'set_proxy true "[\"$ALLOW_CIDR\"]"; sleep 3; [ "$(proxy_pid)" = "$pid" ]'
}

scenario_F() {
  echo "=== F: Web UI ==="
  set_proxy false '[]'
  wait_for 20 '! listening $SOCKS_PORT'
  gui enable "$ALLOW_CIDR"
  check "Web UIの有効化でクライアントがプロキシ通信できる" 'wait_for 15 "[ -n \"\$(via_socks)\" ]"'
  gui reopen "$ALLOW_CIDR"
  gui invalid
  gui empty
  gui disable
  check "Web UIの無効化でポートが閉じる" 'wait_for 20 "! listening $SOCKS_PORT"'
}

scenario_G() {
  echo "=== G: 既知の制約の実測（INFO） ==="
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 20 'listening $SOCKS_PORT'
  api PUT /v1/connection '{"connect":false}' >/dev/null
  sleep 3
  local via
  via=$(via_socks)
  if [ -n "$via" ]; then
    echo "INFO: VPN未接続・Kill Switch ONでも、明示的プロキシ経由の通信は直接($via)で抜ける（Kill SwitchはFORWARDのみが対象。specs/proxyserver/tasks.md「将来課題」参照）"
  else
    echo "INFO: VPN未接続・Kill Switch ONで、明示的プロキシ経由の通信は遮断された"
  fi
}

scenario_H() {
  echo "=== H: proxyコンテナ再起動後の自動復帰 ==="
  set_proxy true "[\"$ALLOW_CIDR\"]"
  wait_for 20 'listening $SOCKS_PORT'
  gw docker compose restart proxy >/dev/null 2>&1
  check "proxyコンテナ再起動後、APIの再通知で3proxyが自動的に再びlistenする（最大約10秒+起動時間）" 'wait_for 60 "listening $SOCKS_PORT && listening $HTTP_PORT"'
  check "復帰後、LAN端末からプロキシ通信できる" 'wait_for 10 "via_socks | is_ip"'
  check "復帰後の状態は active（restartCountは0に戻る）" '[ "$(explicit_state)" = active ] && [ "$(restart_count)" = 0 ]'
}

SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(A B C D E F H G)
for s in "${SCENARIOS[@]}"; do "scenario_$s"; done

echo "== 後始末: 明示的プロキシ無効・VPN切断・Web UI利用者アカウントを削除しインストール直後の未設定状態へ戻す"
set_proxy false '[]'
api PUT /v1/connection '{"connect":false}' >/dev/null
reset_operator_account
e2e_api_cleanup
echo "FAIL件数: $FAILS"
exit "$FAILS"
