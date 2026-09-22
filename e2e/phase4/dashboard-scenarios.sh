#!/bin/bash
# 責務: Phase 4完了基準（wbs/phase4.md）を、Phase 3で構築した検証環境（実VPNログイン済みの
# ゲートウェイ役。e2e/lxc/sync.sh構築済み）上でWeb UI（Playwright）から検証する。
# 実行: [GW_MODE=ssh] bash e2e/phase4/dashboard-scenarios.sh [国コード例: jp]
# 前提: 実VPNベンダーへのログイン済み、透過ゲートウェイ・Kill Switchの設定は本スクリプトが初期化する。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$HERE/../lxc/env.sh"
. "$HERE/../lib/gw.sh"
COUNTRY=${1:-jp}
GW_IP=$(gw_lan_ip)
BASE="http://$GW_IP:8080"
FAILS=0
gui() { node "$HERE/webgui-dashboard.mjs" "$BASE" "$@" || FAILS=$((FAILS+1)); }
api() { curl -s -m 30 -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "$BASE/api$2"; }

# proxy停止・起動コマンド（error-502用。GW_MODEの差はgw.shと同じ方針で吸収する）
if [ "$GW_MODE" = ssh ]; then
  export PROXY_STOP_CMD="ssh $SSH_OPTS $GW_SSH 'cd $GW_REPO_DIR && sudo docker compose stop proxy runner-adguardvpn'"
  export PROXY_START_CMD="ssh $SSH_OPTS $GW_SSH 'cd $GW_REPO_DIR && sudo docker compose start proxy runner-adguardvpn'"
else
  export PROXY_STOP_CMD="lxc exec $GW_NAME --cwd $GW_REPO_DIR -- docker compose stop proxy runner-adguardvpn"
  export PROXY_START_CMD="lxc exec $GW_NAME --cwd $GW_REPO_DIR -- docker compose start proxy runner-adguardvpn"
fi

echo "== 準備: 透過ゲートウェイON・Kill Switch ON・VPN切断へ初期化"
api PUT /v1/connection/config '{"transparentGatewayEnabled":true,"killSwitch":true}' >/dev/null
api PUT /v1/connection '{"connect":false}' >/dev/null
sleep 12

echo "== initial: 暫定表示"
gui initial
echo "== flow: ログイン→国選択→接続→透過GW OFF/ON→状態確認→切断"
gui flow "$COUNTRY"
echo "== log: 接続ログ"
gui log
echo "== ks-off: Kill Switch切替への追従"
gui ks-off
echo "== error-422: 実CLI異常終了のトースト"
gui error-422 "$COUNTRY"
echo "== error-502: proxy停止中のトースト"
gui error-502 "$COUNTRY"
echo "== 後始末: proxy復旧待ち・VPN切断"
sleep 15
api PUT /v1/connection '{"connect":false}' >/dev/null

echo "FAIL件数: $FAILS"
exit "$FAILS"
