#!/bin/sh
# 責務: Compose bundle のローカル契約を検査し、必要時だけ LXD 検証環境の前提を確認する。
# 設定: lab 用 VERIFY_HOST、VERIFY_USER (既定 ubuntu)、VERIFY_SSH_PASSWORD、VERIFY_LAB (既定 acc-vpngwgui)。
#       開発用ひな形は scripts/deploy-verify.env.example。秘密情報は環境変数からのみ渡し、SSHPASS 環境で sshpass に渡す。
# 使い方: scripts/deploy-verify.sh [static|lab]（省略時 static）。lab は bundle を転送し、既存 LXD container の読み取り専用検査だけを行う。
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
mode=${1:-static}
[ "$#" -le 1 ] || { printf '%s\n' '使い方: deploy-verify.sh [static|lab]' >&2; exit 2; }
case "$mode" in static|lab) ;; *) printf '%s\n' '使い方: deploy-verify.sh [static|lab]' >&2; exit 2 ;; esac

run_static() {
  source_root=$1
  failures=0
  check() {
    label=$1
    shift
    if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label" >&2; failures=$((failures + 1)); fi
  }
  compose_json() {
    project=$1
    shift
    docker compose -p "$project" "$@" config --format json
  }
  node_contract() {
    project=$1
    shift
    compose_json "$project" "$@" | node --input-type=module -e '
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      const config = JSON.parse(input);
      const services = config.services ?? {};
      for (const name of ["web", "api", "proxy"]) if (!services[name]) throw new Error(`missing service ${name}`);
      if ((services.web.ports ?? []).length !== 1 || (services.web.ports[0].published ?? "8080") !== (process.env.WEB_PORT ?? "8080")) throw new Error("web published port mismatch");
      if ((services.api.ports ?? []).length || (services.proxy.ports ?? []).length) throw new Error("API/Gateway TCP port published");
      if (services.proxy.network_mode !== "host" || services.api.user !== "10001:10001") throw new Error("service isolation contract mismatch");
      if (!config.networks?.["app-net"]) throw new Error("app-net missing");
      for (const name of ["api-data", "gateway-socket", "ctl-socket"]) if (!config.volumes?.[name]) throw new Error(`volume ${name} missing`);
      const mounts = (name) => services[name].volumes ?? [];
      const apiSocket = mounts("api").filter((m) => m.target === "/run/vpngw-gateway");
      const proxySocket = mounts("proxy").filter((m) => m.target === "/run/vpngw-gateway");
      if (apiSocket.length !== 1 || proxySocket.length !== 1 || apiSocket[0].source !== "gateway-socket" || proxySocket[0].source !== "gateway-socket") throw new Error("gateway-socket must be shared only by API and proxy");
      for (const [name, service] of Object.entries(services)) {
        if (!["api", "proxy"].includes(name) && (service.volumes ?? []).some((m) => m.source === "gateway-socket" || m.target === "/run/vpngw-gateway")) throw new Error(`${name} must not mount gateway-socket`);
      }
      if (services.api.environment.GATEWAY_SOCKET_PATH !== "/run/vpngw-gateway/gateway.sock" || services.proxy.environment.GATEWAY_SOCKET_PATH !== "/run/vpngw-gateway/gateway.sock") throw new Error("UDS path mismatch");
      if (config.name !== process.env.EXPECTED_PROJECT) throw new Error(`project name ${config.name} != ${process.env.EXPECTED_PROJECT}`);
      for (const [name, volume] of Object.entries(config.volumes ?? {})) if (volume.name && !volume.name.startsWith(`${process.env.EXPECTED_PROJECT}_`)) throw new Error(`volume ${name} has unexpected project prefix`);
      const tls = process.env.EXPECTED_TLS === "true";
      const webTlsMounts = mounts("web").filter((m) => m.target.startsWith("/run/vpngwgui/web-tls/"));
      const apiTlsMounts = mounts("api").filter((m) => m.target.startsWith("/run/vpngwgui/gateway-tls/"));
      const proxyTlsMounts = mounts("proxy").filter((m) => m.target.startsWith("/run/vpngwgui/gateway-tls/"));
      if (webTlsMounts.length !== (process.env.EXPECTED_WEB_TLS === "true" ? 2 : 0)) throw new Error("Web TLS mount set mismatch");
      if (apiTlsMounts.length !== (tls ? 3 : 0) || proxyTlsMounts.length !== (tls ? 3 : 0)) throw new Error("Gateway TLS mount set mismatch");
      if (services.api.environment.GATEWAY_TLS_ENABLED !== String(tls) || services.proxy.environment.GATEWAY_TLS_ENABLED !== String(tls)) throw new Error("Gateway TLS flags mismatch");
      if (services.web.environment.WEB_HTTPS_ENABLED !== String(process.env.EXPECTED_WEB_TLS === "true")) throw new Error("Web HTTPS flag mismatch");
      const expectedVendors = (process.env.EXPECTED_VENDORS ?? "").split(",").filter(Boolean);
      for (const vendor of ["runner-protonvpn", "runner-adguardvpn"]) if (Boolean(services[vendor]) !== expectedVendors.includes(vendor)) throw new Error(`vendor service ${vendor} mismatch`);
    '
  }
  cd "$source_root"
  check 'root Compose config, fixed project' sh -c 'docker compose -p vpngwgui -f docker-compose.yml config --quiet'
  project_name=$(docker compose -p vpngwgui -f docker-compose.yml config --format json | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.stdout.write(JSON.parse(s).name)')
  [ "$project_name" = vpngwgui ] && printf 'PASS fixed project name vpngwgui\n' || { printf 'FAIL fixed project name\n' >&2; failures=$((failures + 1)); }
  env_name=$(COMPOSE_PROJECT_NAME=env-override docker compose -f docker-compose.yml config --format json | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.stdout.write(JSON.parse(s).name)')
  cli_name=$(COMPOSE_PROJECT_NAME=env-override docker compose -p cli-override -f docker-compose.yml config --format json | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.stdout.write(JSON.parse(s).name)')
  if [ "$env_name" = env-override ] && [ "$cli_name" = cli-override ]; then printf 'PASS project name precedence and override\n'; else printf 'FAIL project name precedence (env=%s cli=%s)\n' "$env_name" "$cli_name" >&2; failures=$((failures + 1)); fi
  other_volume=$(docker compose -p other-project -f docker-compose.yml config --format json | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.stdout.write(JSON.parse(s).volumes["api-data"].name)')
  if [ "$other_volume" = other-project_api-data ]; then printf 'PASS alternate project gets distinct volume names\n'; else printf 'FAIL alternate project volume name: %s\n' "$other_volume" >&2; failures=$((failures + 1)); fi

  for vendor in none proton adguard both; do
    case "$vendor" in
      none) vendor_args=''; expected='' ;;
      proton) vendor_args='-f vendors/protonvpn/compose.yml'; expected=runner-protonvpn ;;
      adguard) vendor_args='-f vendors/adguardvpn/compose.yml'; expected=runner-adguardvpn ;;
      both) vendor_args='-f vendors/protonvpn/compose.yml -f vendors/adguardvpn/compose.yml'; expected=runner-protonvpn,runner-adguardvpn ;;
    esac
    for web_tls in false true; do
      for gateway_tls in false true; do
        set -- -f docker-compose.yml
        # vendor_args は固定されたリポジトリ相対パスだけを含む。
        # shellcheck disable=SC2086
        set -- "$@" $vendor_args
        [ "$web_tls" = true ] && set -- "$@" -f compose/web-tls.yml
        [ "$gateway_tls" = true ] && set -- "$@" -f compose/api-tls.yml
        label="Compose $vendor WebTLS=$web_tls GatewayTLS=$gateway_tls"
        if WEB_HTTPS_ENABLED="$web_tls" GATEWAY_TLS_ENABLED="$gateway_tls" WEB_TLS_CERT_HOST_PATH=/tmp/web.crt WEB_TLS_KEY_HOST_PATH=/tmp/web.key GATEWAY_TLS_CA_HOST_PATH=/tmp/ca.crt GATEWAY_TLS_CLIENT_CERT_HOST_PATH=/tmp/client.crt GATEWAY_TLS_CLIENT_KEY_HOST_PATH=/tmp/client.key GATEWAY_TLS_SERVER_CERT_HOST_PATH=/tmp/server.crt GATEWAY_TLS_SERVER_KEY_HOST_PATH=/tmp/server.key docker compose -p vpngwgui "$@" config --quiet \
          && EXPECTED_PROJECT=vpngwgui EXPECTED_TLS="$gateway_tls" EXPECTED_WEB_TLS="$web_tls" EXPECTED_VENDORS="$expected" WEB_PORT=${WEB_PORT:-8080} WEB_HTTPS_ENABLED="$web_tls" GATEWAY_TLS_ENABLED="$gateway_tls" WEB_TLS_CERT_HOST_PATH=/tmp/web.crt WEB_TLS_KEY_HOST_PATH=/tmp/web.key GATEWAY_TLS_CA_HOST_PATH=/tmp/ca.crt GATEWAY_TLS_CLIENT_CERT_HOST_PATH=/tmp/client.crt GATEWAY_TLS_CLIENT_KEY_HOST_PATH=/tmp/client.key GATEWAY_TLS_SERVER_CERT_HOST_PATH=/tmp/server.crt GATEWAY_TLS_SERVER_KEY_HOST_PATH=/tmp/server.key node_contract vpngwgui "$@"; then
          printf 'PASS %s\n' "$label"
        else printf 'FAIL %s\n' "$label" >&2; failures=$((failures + 1)); fi
      done
    done
  done

  check 'host-preparation usage and unknown command' sh -c 'sh compose/host-preparation.sh >/dev/null 2>&1 && exit 1; sh compose/host-preparation.sh unknown >/dev/null 2>&1 && exit 1; sh compose/host-preparation.sh --help >/dev/null'
  check 'host-preparation shell tests' sh "$root/compose/host-preparation/tests/run.sh"
  check 'compose contract tests on extracted bundle' env COMPOSE_CONTRACT_ROOT="$source_root" sh "$root/scripts/test-compose-contract.sh"
  check 'TLS compose contract tests on extracted bundle' env COMPOSE_CONTRACT_ROOT="$source_root" sh "$root/scripts/test-compose-tls-contract.sh"
  shell_scripts=$(find . -type f -name '*.sh' -not -path './.git/*' -print)
  if command -v shellcheck >/dev/null 2>&1; then
    # Shellcheck は展開 artifact 内の資材を対象にする。
    if [ -n "$shell_scripts" ] && shellcheck -S warning $shell_scripts; then printf 'PASS shellcheck shipped scripts\n'; else printf 'FAIL shellcheck shipped scripts\n' >&2; failures=$((failures + 1)); fi
  else printf 'FAIL shellcheck unavailable\n' >&2; failures=$((failures + 1)); fi
  [ "$failures" -eq 0 ]
}

make_bundle() {
  temp_root=$(mktemp -d)
  trap 'rm -rf "$temp_root"' EXIT HUP INT TERM
  bundle_file=$temp_root/vpngwgui-verify.tar.gz
  sh "$root/scripts/build-compose-bundle.sh" verify "$bundle_file"
  mkdir "$temp_root/extract"
  tar -xzf "$bundle_file" -C "$temp_root/extract"
  extracted=$(find "$temp_root/extract" -mindepth 1 -maxdepth 1 -type d -print -quit)
}

if [ "$mode" = static ]; then
  if [ -n "${DEPLOY_VERIFY_EXTRACTED_DIR:-}" ]; then
    run_static "$DEPLOY_VERIFY_EXTRACTED_DIR"
  else
    make_bundle
    run_static "$extracted"
  fi
  exit
fi

: "${VERIFY_HOST:?VERIFY_HOST is required for lab mode}"
VERIFY_USER=${VERIFY_USER:-ubuntu}
VERIFY_LAB=${VERIFY_LAB:-acc-vpngwgui}
VERIFY_SSH_PASSWORD=${VERIFY_SSH_PASSWORD:-}
case "$VERIFY_LAB" in ''|*[!A-Za-z0-9_.-]*) printf '%s\n' 'VERIFY_LAB must be a container name' >&2; exit 2 ;; esac
command -v ssh >/dev/null 2>&1 || { printf '%s\n' 'ssh is required' >&2; exit 1; }
command -v scp >/dev/null 2>&1 || { printf '%s\n' 'scp is required' >&2; exit 1; }
if [ -n "$VERIFY_SSH_PASSWORD" ]; then command -v sshpass >/dev/null 2>&1 || { printf '%s\n' 'sshpass is required when VERIFY_SSH_PASSWORD is set' >&2; exit 1; }; fi
make_bundle
remote_bundle=/tmp/vpngwgui-verify-$$.tar.gz
remote_ssh() {
  if [ -n "$VERIFY_SSH_PASSWORD" ]; then SSHPASS=$VERIFY_SSH_PASSWORD sshpass -e ssh -o ConnectTimeout=10 "$VERIFY_USER@$VERIFY_HOST" "$@"
  else ssh -o ConnectTimeout=10 "$VERIFY_USER@$VERIFY_HOST" "$@"
  fi
}
remote_scp() {
  if [ -n "$VERIFY_SSH_PASSWORD" ]; then SSHPASS=$VERIFY_SSH_PASSWORD sshpass -e scp -o ConnectTimeout=10 "$@"
  else scp -o ConnectTimeout=10 "$@"
  fi
}
cleanup_lab() { remote_ssh "rm -f '$remote_bundle'" >/dev/null 2>&1 || true; rm -rf "$temp_root"; }
trap cleanup_lab EXIT HUP INT TERM
printf '== lab prerequisite check: %s (%s)\n' "$VERIFY_HOST" "$VERIFY_LAB"
remote_scp "$bundle_file" "$VERIFY_USER@$VERIFY_HOST:$remote_bundle"
remote_ssh "lxc file push '$remote_bundle' '$VERIFY_LAB/tmp/vpngwgui-verify.tar.gz' && lxc exec '$VERIFY_LAB' -- sh -c 'set -eu; mkdir -p /root/vpngwgui; tar -xzf /tmp/vpngwgui-verify.tar.gz -C /root/vpngwgui --strip-components=1; rm -f /tmp/vpngwgui-verify.tar.gz; cd /root/vpngwgui; sh compose/host-preparation.sh check; docker compose -p vpngwgui config --quiet; echo PASS lab prerequisite and Compose config'"
