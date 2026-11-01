#!/bin/sh
# 責務: hosted E2E の導入（本番と同じインストーラで導入し、E2E 用の上書きを加えて起動する）。要件 1.2・9.1。
# 呼び出し側が先に env.sh と topology.sh を読むこと。
#
# 順序（外部の取得は既定経路が使える間に行う）:
#   1. topology_links（ブリッジを作る。既定経路はまだ変えない）
#   2. provision_install（本番の経路で install。LAN_IFACE はブリッジ）
#   3. provision_start（導入の構成を止め、E2E 用の上書きを追記して起動し直す。イメージのビルドを含む）
#   4. topology_route_isp（既定経路を ISP へ向ける。以降は外部へ出られない）
#   5. provision_wait（API と Web UI の応答を上限 120 秒で待つ）

PROVISION_TIMEOUT_S=120
PROVISION_STACK_DIR="/opt/vpngwgui"

# 目的: 本番と同じ経路で導入する（build-bootstrap の出力の install.sh で install）。
# 入力: checkout（コミット済みのチェックアウトの絶対パス）、commit（その HEAD の 40 桁の 16 進）。
# 出力: 終了コード（導入の成否）。
provision_install() {
  checkout="$1"
  commit="$2"
  mkdir -p "$E2E_WORK_DIR"
  # bootstrap が取得する参照（ブランチ名）を、このコミットへ向ける
  git -C "$checkout" branch -f e2e-install "$commit"
  sh "$checkout/installer/build-bootstrap.sh" refs/heads/e2e-install "$commit" "file://$checkout" > "$E2E_WORK_DIR/install.sh"
  sudo sh "$E2E_WORK_DIR/install.sh" install \
    --set PROVIDERS=protonvpn,adguardvpn \
    --set LAN_IFACE="$E2E_BRIDGE" \
    --set WEB_PORT="$E2E_WEB_PORT"
}

# 目的: 導入の構成を止め、E2E 用の上書きを追記して、ビルドを含めて起動し直す。
# 出力: 終了コード。
provision_start() {
  sudo docker compose --project-directory "$PROVISION_STACK_DIR" -f "$PROVISION_STACK_DIR/docker-compose.yml" down --remove-orphans || true
  # .env の COMPOSE_FILE の末尾に、E2E 用の上書きを追記する（既に含まれていれば追記しない）
  sudo sed -i '/^COMPOSE_FILE=/{/docker-compose.e2e-mock.yml/!s/$/:docker-compose.e2e-mock.yml/}' "$PROVISION_STACK_DIR/.env"
  sudo docker compose --project-directory "$PROVISION_STACK_DIR" --env-file "$PROVISION_STACK_DIR/.env" up -d --build
}

# 目的: API と Web UI が応答するまで待つ（上限 120 秒）。
# API は導入した CA で検証する（検証の無効化はしない）。Web UI は健全性の確認だけ（資格情報を送らない）ので、証明書を検証しない。
# 出力: 両方が応答すれば 0、上限を過ぎたら 1（応答していない側を表示する）。
provision_wait() {
  deadline=$(( $(date +%s) + PROVISION_TIMEOUT_S ))
  web=0
  api=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$web" = 0 ] && [ "$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:$E2E_WEB_PORT/" || true)" = 200 ]; then web=1; fi
    if [ "$api" = 0 ] && [ "$(curl -s --cacert /etc/vpngwgui/pki/api-ca.crt -o /dev/null -w '%{http_code}' "https://127.0.0.1:3000/v1/operator" || true)" = 200 ]; then api=1; fi
    if [ "$web" = 1 ] && [ "$api" = 1 ]; then
      echo "導入後の応答: Web UI と API が応答した"
      return 0
    fi
    sleep 3
  done
  echo "応答の上限（${PROVISION_TIMEOUT_S} 秒）: web=$web api=$api" 1>&2
  return 1
}
