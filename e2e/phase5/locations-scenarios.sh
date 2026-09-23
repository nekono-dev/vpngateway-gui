#!/bin/bash
# 責務: Phase 5完了基準（wbs/phase5.md）を、Phase 3で構築した検証環境（実VPNログイン済みのゲートウェイ役。
# e2e/lxc/sync.sh構築済み）上でWeb UI（Playwright）から検証する。
# 実行: [GW_MODE=ssh] bash e2e/phase5/locations-scenarios.sh
# 前提: 実VPNベンダーへのログイン済み。開始時に透過ゲートウェイON・Kill Switch ON・VPN切断・お気に入り全解除へ初期化する
#       （設定を書き換えるため検証専用環境で実行すること）。
# 出力: 各検証をPASS/FAILで表示し、FAIL件数を終了コードにする。

set -u
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
. "$HERE/../lxc/env.sh"
. "$HERE/../lib/gw.sh"
. "$HERE/../lib/api-auth.sh"
GW_IP=$(gw_lan_ip)
BASE="http://$GW_IP:8080"
FAILS=0
e2e_api_login "$BASE"
gui() { node "$HERE/webgui-locations.mjs" "$BASE" "$@" || FAILS=$((FAILS+1)); }
api() { curl -s -m 60 -b "$E2E_COOKIE_JAR" -X "$1" ${3:+-H 'content-type: application/json' -d "$3"} "$BASE/api$2"; }
check() { # check <説明> <条件が真のときexit 0となるコマンド...>
  local desc=$1; shift
  if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; FAILS=$((FAILS+1)); fi
}

if [ "$GW_MODE" = ssh ]; then
  export PROXY_STOP_CMD="ssh $SSH_OPTS $GW_SSH 'cd $GW_REPO_DIR && sudo docker compose stop proxy runner-adguardvpn'"
  export PROXY_START_CMD="ssh $SSH_OPTS $GW_SSH 'cd $GW_REPO_DIR && sudo docker compose start proxy runner-adguardvpn'"
else
  export PROXY_STOP_CMD="lxc exec $GW_NAME --cwd $GW_REPO_DIR -- docker compose stop proxy runner-adguardvpn"
  export PROXY_START_CMD="lxc exec $GW_NAME --cwd $GW_REPO_DIR -- docker compose start proxy runner-adguardvpn"
fi

echo "== 準備: 透過ゲートウェイON・Kill Switch ON・VPN切断・お気に入り全解除"
api PUT /v1/connection/config '{"transparentGatewayEnabled":true,"killSwitch":true}' >/dev/null
api PUT /v1/connection '{"connect":false}' >/dev/null
for id in $(api GET /v1/connection/locations | python3 -c "import json,sys;print(' '.join(x['id'] for x in json.load(sys.stdin) if x['favorite']))"); do
  api DELETE "/v1/connection/locations/$id/favorite" >/dev/null
done
sleep 12

echo "== list: 都市単位・ping昇順・再計測・設定ダイアログ"
gui list
echo "== filter: 絞り込み"
gui filter
echo "== favorite: お気に入り（ping順・永続化・別ブラウザ共通）"
gui favorite Tokyo Seoul
echo "== connect: リストから接続（(Virtual)付き。接続時指定名から(Virtual)を除く）"
gui connect "Shanghai (Virtual)"
check "APIが接続先ID・国を返す" bash -c "curl -s $BASE/api/v1/connection | grep -q '\"locationId\":\"cn-shanghai-virtual\"'"
echo "== change: 接続中の接続先変更"
gui change "Las Vegas"
check "APIの接続先がLas Vegasに変わっている" bash -c "curl -s $BASE/api/v1/connection | grep -q '\"locationId\":\"us-las-vegas\"'"
echo "== disconnect / last: 最後の接続先へ選択なしで接続"
gui disconnect
check "切断後もAPIの一覧で最後の接続先がLas Vegas" bash -c "curl -s $BASE/api/v1/connection/locations | python3 -c \"import json,sys;print([x['id'] for x in json.load(sys.stdin) if x['lastConnected']])\" | grep -q us-las-vegas"
gui last "Las Vegas"
echo "== error-list: proxy停止中のリスト取得失敗（接続中）"
gui error-list
echo "== 旧形式ファイル互換: settings.jsonにdefaultCountryが残っていても動作する"
gw docker compose exec -T api sh -c 'printf "{\"killSwitch\":true,\"excludedDomains\":[],\"defaultCountry\":\"jp\",\"transparentGatewayEnabled\":true,\"explicitProxyEnabled\":false,\"explicitProxyAllowedCidrs\":[]}" > /var/lib/vpngwgui/settings.json'
if api GET /v1/connection/config | grep -q defaultCountry; then
  echo "FAIL: GET /v1/connection/config がdefaultCountryを返さない"; FAILS=$((FAILS+1))
else
  echo "PASS: GET /v1/connection/config がdefaultCountryを返さない"
fi
api PUT /v1/connection/config '{"killSwitch":true}' >/dev/null
if gw docker compose exec -T api cat /var/lib/vpngwgui/settings.json | grep -q defaultCountry; then
  echo "FAIL: 更新後、保存ファイルからdefaultCountryが消える"; FAILS=$((FAILS+1))
else
  echo "PASS: 更新後、保存ファイルからdefaultCountryが消える"
fi
echo "== 後始末: VPN切断・Web UI利用者アカウントを削除しインストール直後の未設定状態へ戻す"
sleep 10
api PUT /v1/connection '{"connect":false}' >/dev/null
reset_operator_account
e2e_api_cleanup

echo "FAIL件数: $FAILS"
exit "$FAILS"
