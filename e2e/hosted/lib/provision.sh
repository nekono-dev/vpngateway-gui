#!/bin/sh
# 責務: hosted E2E 用の root Compose と mock runner を準備し、サービスの応答を待つ。
# 呼び出し側が先に env.sh と topology.sh を読むこと。
# shellcheck disable=SC2024 # ログ出力先はホスト側の E2E 作業ディレクトリで、sudo の外側からリダイレクトする。

PROVISION_TIMEOUT_S=180
PROVISION_E2E_BUNDLE="/etc/vpngwgui/e2e-ca-bundle.crt"

# 目的: fixture が定義する固定 project と fragment 構成で Compose 操作を実行する。
# 出力: docker compose の標準出力。
provision_compose() {
  action="$1"
  shift
  npx tsx e2e/hosted/fixtures/compose-cli.ts "$action" "$@"
}

# 目的: E2E 専用の ISP 証明書を作り、proxy が読める trust bundle を用意する。
provision_certs() {
  sh e2e/hosted/lib/certs.sh "$E2E_WORK_DIR/certs" >/dev/null || return 1
  cat /etc/ssl/certs/ca-certificates.crt "$E2E_WORK_DIR/certs/ca.crt" > "$E2E_WORK_DIR/ca-bundle.crt"
  sudo install -d -m 0755 /etc/vpngwgui
  sudo install -m 0644 "$E2E_WORK_DIR/ca-bundle.crt" "$PROVISION_E2E_BUNDLE"
}

# 目的: HTTP 既定の root Compose を検証して起動する。TLS fragment・証明書は使用しない。
provision_start() {
  provision_certs || return 1
  export LAN_IFACE="${E2E_INSTALL_LAN_IFACE:-$E2E_BRIDGE}"
  export WEB_PORT="$E2E_WEB_PORT"
  export VPN_PROVIDERS="protonvpn,adguardvpn"
  provision_compose config || return 1
  provision_compose up
}

# 目的: ISP 模擬サービスを名前空間 isp で起動し、起動を待つ（上限30秒）。
provision_isp_start() {
  rm -f "$E2E_ISP_PID_FILE"
  sudo ip netns exec "$E2E_NS_ISP" "$PWD/node_modules/.bin/tsx" e2e/hosted/services/isp-main.ts \
    "0.0.0.0" "$E2E_ISP_SERVICE_IP" "$E2E_WORK_DIR/certs/server.key" "$E2E_WORK_DIR/certs/server.crt" "$E2E_ISP_PID_FILE" \
    > "$E2E_WORK_DIR/isp.log" 2>&1 &
  deadline=$(( $(date +%s) + 30 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ -s "$E2E_ISP_PID_FILE" ]; then return 0; fi
    sleep 1
  done
  echo "ISP の模擬サービスが起動しなかった（$E2E_WORK_DIR/isp.log を参照）" 1>&2
  return 1
}

# 目的: Web と Web `/api` 経由の API 応答を待つ（上限180秒）。
provision_wait() {
  deadline=$(( $(date +%s) + PROVISION_TIMEOUT_S ))
  web=0
  api=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$web" = 0 ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$E2E_WEB_PORT/" || true)" = 200 ]; then web=1; fi
    if [ "$api" = 0 ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$E2E_WEB_PORT/api/v1/operator" || true)" = 200 ]; then api=1; fi
    if [ "$web" = 1 ] && [ "$api" = 1 ]; then
      echo "Compose 起動後の応答: Web UI と Web API proxy が応答した"
      return 0
    fi
    sleep 3
  done
  echo "応答の上限（${PROVISION_TIMEOUT_S} 秒）: web=$web api=$api" 1>&2
  return 1
}
