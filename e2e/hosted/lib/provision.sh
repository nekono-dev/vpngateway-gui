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
PROVISION_PKI_DIR="/etc/vpngwgui/pki"
# proxy に渡す、テスト CA を含む信頼の束（docker-compose.e2e-mock.yml が参照する絶対パス）
PROVISION_E2E_BUNDLE="/etc/vpngwgui/e2e-ca-bundle.crt"

# 目的: Docker が FORWARD の既定ポリシーを DROP にしない状態にする（導入の setup.sh と同じ設定。E2E の前提）。
# 理由: ランナーの Docker は、既に起動している間に daemon.json を作っても再起動するまで設定が効かず、
#      FORWARD が DROP のままになる（LAN の転送が Docker の規則で落ちる）。製品の installer は警告のみ行う。
# 副作用: /etc/docker/daemon.json が無ければ作り、Docker を再起動する。最後に FORWARD の既定を確かめ、DROP なら ACCEPT にする。
# 出力: 終了コード。
provision_docker_forward() {
  if ! sudo test -e /etc/docker/daemon.json; then
    printf '{\n  "ip-forward-no-drop": true\n}\n' | sudo tee /etc/docker/daemon.json >/dev/null
    sudo systemctl restart docker || return 1
  fi
  # 既存の daemon.json に設定が無い場合でも、転送を通せるよう既定を ACCEPT にする（E2E の専用ホストのみ）
  if sudo iptables -S FORWARD 2>/dev/null | grep -q -- '-P FORWARD DROP'; then
    sudo iptables -P FORWARD ACCEPT || return 1
  fi
  return 0
}

# 目的: 本番と同じ経路で導入する（build-bootstrap の出力の install.sh で install）。
# 入力: checkout（コミット済みのチェックアウトの絶対パス）、commit（その HEAD の 40 桁の 16 進）。
# 出力: 終了コード（導入の成否）。
provision_install() {
  checkout="$1"
  commit="$2"
  mkdir -p "$E2E_WORK_DIR"
  provision_docker_forward || return 1
  # bootstrap が取得する参照（ブランチ名）を、このコミットへ向ける
  git -C "$checkout" branch -f e2e-install "$commit"
  sh "$checkout/installer/build-bootstrap.sh" refs/heads/e2e-install "$commit" "file://$checkout" > "$E2E_WORK_DIR/install.sh"
  sudo sh "$E2E_WORK_DIR/install.sh" install \
    --set PROVIDERS=protonvpn,adguardvpn \
    --set LAN_IFACE="${E2E_INSTALL_LAN_IFACE:-$E2E_BRIDGE}" \
    --set WEB_PORT="$E2E_WEB_PORT"
}

# 目的: 導入の構成を止め、E2E 用の上書きを追記して、ビルドを含めて起動し直す。
# 出力: 終了コード。
provision_start() {
  provision_certs || return 1
  sudo docker compose --project-directory "$PROVISION_STACK_DIR" -f "$PROVISION_STACK_DIR/docker-compose.yml" down --remove-orphans || true
  # .env の COMPOSE_FILE の末尾に、E2E 用の上書きを追記する（既に含まれていれば追記しない）
  sudo sed -i '/^COMPOSE_FILE=/{/docker-compose.e2e-mock.yml/!s/$/:docker-compose.e2e-mock.yml/}' "$PROVISION_STACK_DIR/.env"
  sudo docker compose --project-directory "$PROVISION_STACK_DIR" --env-file "$PROVISION_STACK_DIR/.env" up -d --build
}

# 目的: テスト用の CA と ISP の証明書を作り直し、proxy が読める信頼の束を作る（E2E 専用。本番の経路には入らない）。
# 副作用: 作業場所の certs/（CA・ISP の証明書）と、/etc/vpngwgui/e2e-ca-bundle.crt（システムの CA とテスト CA の束）を作る。
#   proxy は、この束を CURL_CA_BUNDLE（docker-compose.e2e-mock.yml）で読み、ISP の echo を検証できる（要件 8.6）。
# 出力: 終了コード。
provision_certs() {
  sh e2e/hosted/lib/certs.sh "$E2E_WORK_DIR/certs" >/dev/null || return 1
  cat /etc/ssl/certs/ca-certificates.crt "$E2E_WORK_DIR/certs/ca.crt" > "$E2E_WORK_DIR/ca-bundle.crt"
  sudo install -d -m 0755 /etc/vpngwgui
  sudo install -m 0644 "$E2E_WORK_DIR/ca-bundle.crt" "$PROVISION_E2E_BUNDLE"
}

# 目的: ISP の模擬サービス（echo・DoH・平文 DNS）を isp の名前空間で起動し、起動を待つ（上限 30 秒）。
# 前提: topology_links が済んでいること（isp の名前空間がある）。証明書は provision_certs が作ってあること。
# 副作用: $E2E_ISP_PID_FILE に PID を書く。停止は topology_down が行う。
# 出力: 終了コード。
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

# 目的: 導入が作った API の CA を、作業場所へ読める形で複製する（検証の入力に使う。秘密鍵は複製しない）。
# 出力: 作業場所の api-ca.crt のパス（標準出力）。
provision_export_ca() {
  mkdir -p "$E2E_WORK_DIR"
  sudo cat "$PROVISION_PKI_DIR/api-ca.crt" > "$E2E_WORK_DIR/api-ca.crt"
  echo "$E2E_WORK_DIR/api-ca.crt"
}

# 目的: API と Web UI が応答するまで待つ（上限 120 秒）。
# API は導入した CA で検証する（検証の無効化はしない）。Web UI は健全性の確認だけ（資格情報を送らない）ので、証明書を検証しない。
# 出力: 両方が応答すれば 0、上限を過ぎたら 1（応答していない側を表示する）。
provision_wait() {
  deadline=$(( $(date +%s) + PROVISION_TIMEOUT_S ))
  ca="$(provision_export_ca)"
  web=0
  api=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$web" = 0 ] && [ "$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:$E2E_WEB_PORT/" || true)" = 200 ]; then web=1; fi
    if [ "$api" = 0 ] && [ "$(curl -s --cacert "$ca" -o /dev/null -w '%{http_code}' "https://127.0.0.1:3000/v1/operator" || true)" = 200 ]; then api=1; fi
    if [ "$web" = 1 ] && [ "$api" = 1 ]; then
      echo "導入後の応答: Web UI と API が応答した"
      return 0
    fi
    sleep 3
  done
  echo "応答の上限（${PROVISION_TIMEOUT_S} 秒）: web=$web api=$api" 1>&2
  return 1
}
