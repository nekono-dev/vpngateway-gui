#!/bin/sh
# 責務: hosted E2E 用の root Compose と mock runner を準備し、サービスの応答を待つ。
# 呼び出し側が先に env.sh と topology.sh を読むこと。
# shellcheck disable=SC2024 # ログ出力先はホスト側の E2E 作業ディレクトリで、sudo の外側からリダイレクトする。

PROVISION_TIMEOUT_S=180
PROVISION_E2E_BUNDLE="/etc/vpngwgui/e2e-ca-bundle.crt"
PROVISION_ENV_BACKUP="${E2E_WORK_DIR:-e2e/hosted/.work}/hosted-env.backup"
PROVISION_ENV_EXISTED=0
PROVISION_ENV_ACTIVE=0

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
  export LAN_IFACE="$E2E_BRIDGE"
  export WEB_PORT="$E2E_WEB_PORT"
  export VPN_PROVIDERS="protonvpn,adguardvpn"
  provision_compose config || return 1
  provision_compose up
}

# 目的: host-preparation が読む root .env に hosted topology の LAN を設定する。
provision_set_host_env() {
  mkdir -p "$(dirname "$PROVISION_ENV_BACKUP")"
  if [ -f .env ]; then
    cp -p .env "$PROVISION_ENV_BACKUP" || return 1
    PROVISION_ENV_EXISTED=1
  else
    rm -f "$PROVISION_ENV_BACKUP"
    PROVISION_ENV_EXISTED=0
  fi
  temporary_env=".env.hosted.$$"
  if [ -f .env ]; then
    awk '!/^[[:space:]]*LAN_IFACE[[:space:]]*=/' .env > "$temporary_env" || return 1
  else
    : > "$temporary_env"
  fi
  printf 'LAN_IFACE=%s\n' "$E2E_BRIDGE" >> "$temporary_env" || return 1
  chmod 600 "$temporary_env" || return 1
  mv "$temporary_env" .env || return 1
  PROVISION_ENV_ACTIVE=1
}

# 目的: host-preparation の .env 変更を元に戻し、次の群と作業環境へ影響させない。
provision_restore_host_env() {
  if [ "$PROVISION_ENV_ACTIVE" -eq 1 ]; then
    if [ "$PROVISION_ENV_EXISTED" -eq 1 ] && [ -f "$PROVISION_ENV_BACKUP" ]; then
      cp -p "$PROVISION_ENV_BACKUP" .env || return 1
    elif [ "$PROVISION_ENV_EXISTED" -eq 0 ]; then
      rm -f .env
    fi
  fi
  rm -f "$PROVISION_ENV_BACKUP"
  PROVISION_ENV_EXISTED=0
  PROVISION_ENV_ACTIVE=0
}

# 目的: topology 作成後、Compose 起動前にホスト要件を検査して適用する。
provision_host_preparation() {
  group="$1"
  out="e2e/artifacts/hosted/$group/diag"
  mkdir -p "$out"
  provision_set_host_env || { echo 'hosted 用 .env を準備できませんでした' >&2; return 1; }
  if ! sudo sh compose/host-preparation.sh check > "$out/host-preparation-check.txt" 2>&1; then
    echo 'host-preparation check に失敗しました:' >&2
    cat "$out/host-preparation-check.txt" >&2
    return 1
  fi
  if ! sudo sh compose/host-preparation.sh apply > "$out/host-preparation-apply.txt" 2>&1; then
    echo 'host-preparation apply に失敗しました:' >&2
    cat "$out/host-preparation-apply.txt" >&2
    return 1
  fi
}

# 目的: hosted 群を準備する。host-preparation は topology が存在する間だけ適用する。
provision_group_prepare() {
  group="$1"
  hosted_cleanup
  topology_down
  topology_links || return 1
  provision_host_preparation "$group" || return 1
  provision_start || return 1
  if [ "$group" = gateway ]; then provision_isp_start || return 1; fi
  # lifecycle は資材更新相当の build（レジストリへの接続が要る）を試験の途中で行い、通信の経路には依存しない。
  # 既定経路を ISP 模擬へ切り替えると build が Docker Hub に届かず失敗するため、lifecycle は実回線の経路のまま実行する。
  if [ "$group" != lifecycle ]; then topology_route_isp || return 1; fi
  provision_wait || return 1
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
