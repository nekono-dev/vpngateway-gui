#!/bin/bash
# 責務: Phase 11完了基準のうち、実VPN（AdGuard VPN）に接続中にモックProton VPNへ切り替えたときの、実ネットワークでの挙動を検証する
#       （現在のVPNが切断されトンネルが消える・Kill Switch ONでLAN端末の通信が遮断される・切り戻して再接続すると再びVPN経由になる）。
#       実VPNログイン済みのゲートウェイ役（GW_MODE=ssh）に、モックランナー付きの構成（docker-compose.e2e-mock.yml）を一時的に重ねて行う。
# 実行: GW_MODE=ssh bash e2e/phase11/real-switch-scenarios.sh
# 前提: e2e/lxc/sync.sh済み・AdGuard VPNログイン済み・LAN端末役（e2e/lxc/setup.sh）。終了時に通常の構成（モックランナー無し・Web 8080）へ戻す。
#       検証専用環境で実行すること（設定・接続状態を書き換える）。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$HERE/../lxc/env.sh"
. "$HERE/../lib/gw.sh"
BASE_URL="http://$(gw_lan_ip):18080"
FAILS=0
client() { lxc exec "$CLIENT_NAME" -- "$@"; }
client_ip() { client curl -s -m 8 https://api.ipify.org 2>/dev/null; }
api() { curl -s -m 60 -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "$BASE_URL/api$2"; }
check() { local desc=$1; shift; if eval "$*"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS+1)); fi; }
wait_for() { local n=$1; shift; for _ in $(seq "$n"); do if eval "$1"; then return 0; fi; sleep 1; done; return 1; }
has_tun() { gw ip link show tun0 >/dev/null 2>&1; }
has_vpn_rule() { gw nft list table inet vpngwgui 2>/dev/null | grep -q 'oifname "tun[0-9]*" accept'; }
active_provider() { api GET /v1/providers | python3 -c "import json,sys;print([p['id'] for p in json.load(sys.stdin) if p['active']][0])"; }

# モックランナー付きの構成へ（プロファイルのディレクトリをゲートウェイ役に作り、composeへ渡す）
gw sh -c "rm -rf e2e-profiles && mkdir -p e2e-profiles && cp api/config/profiles/*.json e2e-profiles/ && cp api/test-fixtures/profiles/mockproton.json e2e-profiles/ && chmod 755 e2e-profiles && chmod 644 e2e-profiles/*.json"
DCF="docker compose -f docker-compose.yml -f docker-compose.e2e-mock.yml"
E2E_ENV="E2E_PROFILES_DIR=$GW_REPO_DIR/e2e-profiles E2E_PROVIDERS=adguardvpn,mockproton"
restore() {
  gw sh -c "$E2E_ENV $DCF down >/dev/null 2>&1; docker compose up -d --remove-orphans >/dev/null 2>&1; rm -rf e2e-profiles"
}
trap restore EXIT

echo "== 準備: モックランナー付きの構成の起動・透過GW ON・Kill Switch ON・VPN切断"
gw sh -c "$E2E_ENV $DCF up -d --build >/dev/null 2>&1" || { echo "FAIL: 起動に失敗"; exit 1; }
wait_for 60 'api GET /v1/providers | grep -q mockproton'
api PUT /v1/connection/config '{"transparentGatewayEnabled":true,"killSwitch":true}' >/dev/null
api PUT /v1/providers/active '{"providerId":"adguardvpn"}' >/dev/null
api PUT /v1/connection '{"connect":false}' >/dev/null
sleep 12
BASE_IP=$(gw curl -s -m 8 https://api.ipify.org)

echo "== AdGuard VPN（実VPN）へ接続（検証環境ではjpの出口IPが直接の出口IPと一致するためusを使う）"
api PUT /v1/connection '{"connect":true,"locationId":"us-las-vegas"}' >/dev/null
wait_for 30 'has_vpn_rule'
check "実VPN接続中: トンネルがあり、LAN端末がVPN経由（直接と異なるIP）で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'

echo "== switch: 接続中にモックProton VPNへ切り替える（現在の実VPNを自動で切断）"
check "切替のAPIが成功する（200）" '[ "$(curl -s -o /dev/null -w "%{http_code}" -m 90 -X PUT -H "content-type: application/json" -d "{\"providerId\":\"mockproton\"}" $BASE_URL/api/v1/providers/active)" = 200 ]'
check "選択中がmockprotonになる" '[ "$(active_provider)" = mockproton ]'
check "実VPNが切断され、トンネル（tun0）が消える" '! has_tun'
check "Kill Switch ON: VPN向けacceptルールが撤去される（ネットワークコンテナへの再確認通知）" 'wait_for 15 "! has_vpn_rule"'
check "Kill Switch ON: LAN端末の外部通信が遮断される（リークしない）" '[ -z "$(client_ip)" ]'
check "モックを選択中の接続状態は切断中" 'api GET /v1/connection | grep -q "\"status\":\"disconnected\""'

echo "== switch back: AdGuard VPNへ戻し、再接続すると再びVPN経由になる（ログイン状態・お気に入り等が保持される）"
check "切り戻しのAPIが成功する（200）" '[ "$(curl -s -o /dev/null -w "%{http_code}" -m 60 -X PUT -H "content-type: application/json" -d "{\"providerId\":\"adguardvpn\"}" $BASE_URL/api/v1/providers/active)" = 200 ]'
check "AdGuard VPNのログイン状態（Premium）が保持されている" 'api GET /v1/session | grep -q "\"loggedIn\":true"'
api PUT /v1/connection '{"connect":true,"locationId":"us-las-vegas"}' >/dev/null
wait_for 30 'has_vpn_rule'
check "再接続後: LAN端末がVPN経由で通信できる" '[ -n "$(client_ip)" ] && [ "$(client_ip)" != "$BASE_IP" ]'

echo "== 後始末: VPN切断"
api PUT /v1/connection '{"connect":false}' >/dev/null
echo "== 結果: FAIL=$FAILS"
exit "$FAILS"
