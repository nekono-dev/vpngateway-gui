#!/usr/bin/env bash
# 根拠:
# - e2e/hosted/specs/tls/tls-matrix.spec.ts:12-15,33-69,124-145 (port/config/start/composeArgs)
# - e2e/hosted/lib/tls-matrix-certs.sh:33-43 (正規 Web 証明書/CA、invalid 証明書)
# - compose/web-tls.yml:1-10 (mount と WEB_TLS_*_FILE)
# - docker-compose.yml:5-17 (WEB_PORT、HTTPS flag、単一 web listener)
# - web/server/tls-options.ts:14-34, web/server/index.ts:18-25,47-55 (証明書検証と HTTPS 起動)
# - README.md:97-118, .kiro/specs/single-node-deployment/tasks.md:349,450,457
# 責務: 実機受入 8.6 の Web HTTPS 証明書失敗閉鎖と平文 listener 不在を記録する。
set -Eeuo pipefail

ROOT=$(pwd)
CERT_DIR="$ROOT/e2e/hosted/.work/tls-matrix"
OUT_DIR=/tmp/lab-acc
LOG="$OUT_DIR/acc-8.6-web-$(date -u +%Y%m%dT%H%M%SZ).log"
PORT=${E2E_WEB_PORT:-18080}
PLAIN_ALT_PORT=${E2E_WEB_PLAIN_ALT_PORT:-18081}
PROJECT=vpngwgui
# hosted の provision_start（e2e/hosted/lib/provision.sh）と同じく、有効なベンダーと LAN 側インターフェースを渡す
export VPN_PROVIDERS=${VPN_PROVIDERS:-protonvpn,adguardvpn} LAN_IFACE=${LAN_IFACE:-e2eseg}
FRAGMENTS=(vendors/protonvpn/compose.yml vendors/adguardvpn/compose.yml docker-compose.e2e-mock.yml e2e/hosted/vendors/protonvpn/compose.yml e2e/hosted/vendors/adguardvpn/compose.yml compose/web-tls.yml)
OVERRIDE=$(mktemp /tmp/acc-8.6-web.XXXXXX.yml)
cleanup() {
  local status=$?
  trap - EXIT
  WEB_PORT="$PORT" WEB_HTTPS_ENABLED=true WEB_TLS_CERT_HOST_PATH="$CERT_DIR/web/server.crt" WEB_TLS_KEY_HOST_PATH="$CERT_DIR/web/server.key" compose down >>"$LOG" 2>&1 || true
  rm -f "$OVERRIDE"
  printf '\n終了 UTC: %s (exit=%s)\n' "$(date -u +%FT%TZ)" "$status" >>"$LOG"
  printf '記録: %s\n' "$LOG"
  exit "$status"
}
compose() {
  local args=(compose -p "$PROJECT" -f docker-compose.yml)
  local f
  for f in "${FRAGMENTS[@]}"; do args+=(-f "$f"); done
  docker "${args[@]}" "$@"
}
trap cleanup EXIT
mkdir -p "$OUT_DIR"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

if [[ ! -d "$ROOT/e2e/hosted" || ! -f "$CERT_DIR/web/ca.crt" ]]; then
  echo "証明書がありません。先に sh e2e/hosted/lib/tls-matrix-certs.sh e2e/hosted/.work/tls-matrix を実行してください。" >&2
  exit 2
fi
for file in web/server.crt web/server.key web/ca.crt invalid/wrong-ca-server.crt invalid/wrong-ca-server.key invalid/expired-server.crt invalid/expired-server.key invalid/san-mismatch.crt invalid/san-mismatch.key; do
  [[ -r "$CERT_DIR/$file" ]] || { echo "証明書ファイルがありません: $CERT_DIR/$file" >&2; exit 2; }
done

cat > "$OVERRIDE" <<'YAML'
services:
  web:
    ports:
      - "${WEB_PORT}:8080"
YAML
# 上書き fragment は実行中ケースに末尾追加し、Compose の port/env 解決に使う。
FRAGMENTS+=("$OVERRIDE")
WEB_PORT="$PORT" WEB_HTTPS_ENABLED=true WEB_TLS_CERT_HOST_PATH="$CERT_DIR/web/server.crt" WEB_TLS_KEY_HOST_PATH="$CERT_DIR/web/server.key" compose config --quiet

record_case() {
  # ca・name: 失敗理由を1つに絞るため、ケースごとに検証に使う CA と接続名を変える（不正証明書は gateway CA 発行、SAN は gateway.local）
  local label=$1 cert=$2 key=$3 expected=$4 ca=${5:-web/ca.crt} name=${6:-localhost}
  local started cmd rc out plain_rc plain_http api_rc api_http plain_api_rc plain_api_http
  local cert_host key_host log_text state
  cert_host="$CERT_DIR/$cert"; key_host="$CERT_DIR/$key"
  printf '\n=== ケース: %s | UTC: %s ===\n' "$label" "$(date -u +%FT%TZ)"
  printf -v cmd 'WEB_PORT=%q WEB_HTTPS_ENABLED=true WEB_TLS_CERT_HOST_PATH=%q WEB_TLS_KEY_HOST_PATH=%q docker compose -p %q -f docker-compose.yml' "$PORT" "$cert_host" "$key_host" "$PROJECT"
  local f; for f in "${FRAGMENTS[@]}"; do printf -v cmd '%s -f %q' "$cmd" "$f"; done
  echo "コマンド: $cmd down && $cmd up -d"
  WEB_PORT="$PORT" WEB_HTTPS_ENABLED=true WEB_TLS_CERT_HOST_PATH="$cert_host" WEB_TLS_KEY_HOST_PATH="$key_host" compose down || true
  if WEB_PORT="$PORT" WEB_HTTPS_ENABLED=true WEB_TLS_CERT_HOST_PATH="$cert_host" WEB_TLS_KEY_HOST_PATH="$key_host" compose up -d; then
    rc=0; started=yes
  else
    rc=$?; started=no
  fi
  echo "compose up 結果: exit=$rc"
  sleep 3
  # API の準備完了を待つ（待機だけは証明書検証を省いた接続で行い、判定は下の厳密な検証で行う。上限90秒）
  if [[ "$started" == yes ]]; then
    local waited=0
    until [[ "$(curl -sk --max-time 3 -o /dev/null -w '%{http_code}' "https://127.0.0.1:$PORT/api/v1/operator" 2>/dev/null)" == 200 ]] || (( waited >= 90 )); do sleep 2; waited=$((waited + 2)); done
    echo "API 準備待ち: ${waited}秒"
  fi
  log_text=$(WEB_PORT="$PORT" WEB_HTTPS_ENABLED=true WEB_TLS_CERT_HOST_PATH="$cert_host" WEB_TLS_KEY_HOST_PATH="$key_host" compose logs --no-color --tail 80 web 2>&1 || true)
  state=$(WEB_PORT="$PORT" WEB_HTTPS_ENABLED=true WEB_TLS_CERT_HOST_PATH="$cert_host" WEB_TLS_KEY_HOST_PATH="$key_host" compose ps --format '{{.Service}} {{.State}} {{.ExitCode}}' web 2>&1 || true)
  echo "web 状態: $state"
  echo "web 起動ログ: $log_text"
  local base="https://$name:$PORT"
  local resolve_arg="$name:$PORT:127.0.0.1"
  local tls_root="$OUT_DIR/curl-$label"
  mkdir -p "$tls_root"
  echo "コマンド: curl --silent --show-error --max-time 5 --cacert $CERT_DIR/$ca --resolve $resolve_arg -o $tls_root/root.body -w '%{http_code}' $base/"
  set +e
  out=$(curl --silent --show-error --max-time 5 --cacert "$CERT_DIR/$ca" --resolve "$resolve_arg" -o "$tls_root/root.body" -w '%{http_code}' "$base/" 2>"$tls_root/root.err"); rc=$?
  echo "HTTPS / 結果: exit=$rc HTTP=${out:-none} error=$(<"$tls_root/root.err")"
  echo "コマンド: curl --silent --show-error --max-time 5 --cacert $CERT_DIR/$ca --resolve $resolve_arg -o $tls_root/api.body -w '%{http_code}' $base/api/v1/operator"
  api_http=$(curl --silent --show-error --max-time 5 --cacert "$CERT_DIR/$ca" --resolve "$resolve_arg" -o "$tls_root/api.body" -w '%{http_code}' "$base/api/v1/operator" 2>"$tls_root/api.err"); api_rc=$?
  echo "HTTPS API 結果: exit=$api_rc HTTP=${api_http:-none} error=$(<"$tls_root/api.err")"
  echo "コマンド: curl --silent --show-error --max-time 3 -o $tls_root/plain-root.body -w '%{http_code}' http://127.0.0.1:$PORT/"
  plain_http=$(curl --silent --show-error --max-time 3 -o "$tls_root/plain-root.body" -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>"$tls_root/plain-root.err"); plain_rc=$?
  echo "平文 / 結果: exit=$plain_rc HTTP=${plain_http:-none} error=$(<"$tls_root/plain-root.err") body_bytes=$(wc -c < "$tls_root/plain-root.body" 2>/dev/null || echo 0)"
  echo "コマンド: curl --silent --show-error --max-time 3 -o $tls_root/plain-api.body -w '%{http_code}' http://127.0.0.1:$PORT/api/v1/operator"
  plain_api_http=$(curl --silent --show-error --max-time 3 -o "$tls_root/plain-api.body" -w '%{http_code}' "http://127.0.0.1:$PORT/api/v1/operator" 2>"$tls_root/plain-api.err"); plain_api_rc=$?
  echo "平文 API 結果: exit=$plain_api_rc HTTP=${plain_api_http:-none} error=$(<"$tls_root/plain-api.err") body_bytes=$(wc -c < "$tls_root/plain-api.body" 2>/dev/null || echo 0)"
  echo "コマンド: curl --silent --show-error --max-time 3 http://127.0.0.1:$PLAIN_ALT_PORT/ と /api/v1/operator"
  curl --silent --show-error --max-time 3 -o "$tls_root/alt-root.body" -w 'root HTTP=%{http_code}\n' "http://127.0.0.1:$PLAIN_ALT_PORT/" 2>"$tls_root/alt-root.err"; local alt_root_rc=$?
  curl --silent --show-error --max-time 3 -o "$tls_root/alt-api.body" -w 'api HTTP=%{http_code}\n' "http://127.0.0.1:$PLAIN_ALT_PORT/api/v1/operator" 2>"$tls_root/alt-api.err"; local alt_api_rc=$?
  echo "別ポート平文結果: root exit=$alt_root_rc error=$(<"$tls_root/alt-root.err"); API exit=$alt_api_rc error=$(<"$tls_root/alt-api.err")"
  set -e
  if [[ "$expected" == valid ]]; then
    if [[ "$started" == yes && "$out" == 200 && $rc -eq 0 && $api_rc -eq 0 && "$api_http" == 200 && $plain_rc -ne 0 && $plain_api_rc -ne 0 && $alt_root_rc -ne 0 && $alt_api_rc -ne 0 ]]; then
      echo "判定: PASS (正規 CA で HTTPS 200、平文では応答なし)"
    else echo "判定: FAIL (正規 HTTPS または平文拒否の期待に不一致)"; FAILURES=$((FAILURES + 1)); fi
  elif [[ "$started" == no ]]; then
    if [[ $rc -ne 0 && $plain_rc -ne 0 && $plain_api_rc -ne 0 && $alt_root_rc -ne 0 && $alt_api_rc -ne 0 ]]; then echo "判定: PASS (Web 起動拒否、降格応答なし)"; else echo "判定: FAIL (起動拒否時に平文応答あり)"; FAILURES=$((FAILURES + 1)); fi
  else
    if [[ $rc -ne 0 && $api_rc -ne 0 && $plain_rc -ne 0 && $plain_api_rc -ne 0 && $alt_root_rc -ne 0 && $alt_api_rc -ne 0 ]]; then echo "判定: PASS (証明書検証失敗、平文応答なし; 期待=$expected)"; else echo "判定: FAIL (不正証明書で HTTPS/API 応答または平文応答を確認)"; FAILURES=$((FAILURES + 1)); fi
  fi
  # デバッグ用本文はサイズだけ判定に使い、秘密情報をログへ出さない。
  rm -rf "$tls_root"
}
FAILURES=0
record_case 正規 web/server.crt web/server.key valid
# 誤った CA: 名前は SAN と一致、信頼する CA（gateway CA）と発行元が違うことだけが原因になる
record_case wrong-ca invalid/wrong-ca-server.crt invalid/wrong-ca-server.key wrong-ca gateway/ca.crt gateway.local
# 期限切れ: 発行元（gateway CA）と名前は一致し、期限だけが原因になる
record_case expired invalid/expired-server.crt invalid/expired-server.key expired gateway/ca.crt gateway.local
# SAN 不一致: 発行元（gateway CA）は一致し、名前（gateway.local と SAN other-gateway.local）だけが原因になる
record_case san-mismatch invalid/san-mismatch.crt invalid/san-mismatch.key san-mismatch gateway/ca.crt gateway.local
echo "総合判定: failures=$FAILURES"
(( FAILURES == 0 ))
