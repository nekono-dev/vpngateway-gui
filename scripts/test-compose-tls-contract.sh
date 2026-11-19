#!/bin/sh
# 責務: TLS override fragment の独立性と証明書 mount 条件を検証する。
set -eu

root_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir"

# Gateway の TCP 制御 port を Compose・起動経路から除き、UDS のみを残す。
if grep -Eq 'GATEWAY_PORT|8443' proxy/src/server.ts; then
  printf 'Gateway の旧 TCP port 設定が残っています\n' >&2
  exit 1
fi
if grep -Eq 'GATEWAY_PORT|8443' docker-compose.yml compose/api-tls.yml compose/web-tls.yml; then
  printf 'Compose 構成に Gateway TCP port の設定があります\n' >&2
  exit 1
fi

# Compose の Gateway TLS 入力と、API/proxy loader の実際の入力名を確認する。
for name in GATEWAY_TLS_CA_FILE GATEWAY_TLS_CLIENT_CERT_FILE GATEWAY_TLS_CLIENT_KEY_FILE; do
  grep -Fq "$name" compose/api-tls.yml || { printf 'API TLS fragment に %s がありません\n' "$name" >&2; exit 1; }
done
for name in GATEWAY_TLS_CA_FILE GATEWAY_TLS_CERT_FILE GATEWAY_TLS_KEY_FILE; do
  grep -Fq "$name" proxy/src/gateway-channel/tls-options.ts || { printf 'Gateway TLS loader に %s がありません\n' "$name" >&2; exit 1; }
done
for name in GATEWAY_TLS_CA_FILE GATEWAY_TLS_CLIENT_CERT_FILE GATEWAY_TLS_CLIENT_KEY_FILE; do
  grep -Fq "$name" api/src/proxy-client/gateway-tls-options.ts || { printf 'API TLS loader に %s がありません\n' "$name" >&2; exit 1; }
done
grep -Fq 'WEB_TLS_CERT_FILE' compose/web-tls.yml || { printf 'Web TLS fragment に WEB_TLS_CERT_FILE がありません\n' >&2; exit 1; }
grep -Fq 'WEB_TLS_KEY_FILE' compose/web-tls.yml || { printf 'Web TLS fragment に WEB_TLS_KEY_FILE がありません\n' >&2; exit 1; }

for vendor_set in none proton adguard both; do
  vendor_files=''
  case "$vendor_set" in
    proton) vendor_files='vendors/protonvpn/compose.yml' ;;
    adguard) vendor_files='vendors/adguardvpn/compose.yml' ;;
    both) vendor_files='vendors/protonvpn/compose.yml vendors/adguardvpn/compose.yml' ;;
  esac
  for web_tls in false true; do
    for gateway_tls in false true; do
      files='-f docker-compose.yml'
      if [ -n "$vendor_files" ]; then
        # shellcheck disable=SC2086
        for vendor_file in $vendor_files; do files="$files -f $vendor_file"; done
      fi
      if [ "$web_tls" = true ]; then files="$files -f compose/web-tls.yml"; fi
      if [ "$gateway_tls" = true ]; then files="$files -f compose/api-tls.yml"; fi
      # shellcheck disable=SC2086
      WEB_HTTPS_ENABLED="$web_tls" GATEWAY_TLS_ENABLED="$gateway_tls" WEB_TLS_CERT_HOST_PATH=/tmp/web.crt WEB_TLS_KEY_HOST_PATH=/tmp/web.key GATEWAY_TLS_CA_HOST_PATH=/tmp/gateway-ca.crt GATEWAY_TLS_CLIENT_CERT_HOST_PATH=/tmp/api-client.crt GATEWAY_TLS_CLIENT_KEY_HOST_PATH=/tmp/api-client.key GATEWAY_TLS_SERVER_CERT_HOST_PATH=/tmp/gateway-server.crt GATEWAY_TLS_SERVER_KEY_HOST_PATH=/tmp/gateway-server.key docker compose -p vpngwgui $files config --quiet
      # shellcheck disable=SC2086
      config=$(WEB_HTTPS_ENABLED="$web_tls" GATEWAY_TLS_ENABLED="$gateway_tls" WEB_TLS_CERT_HOST_PATH=/tmp/web.crt WEB_TLS_KEY_HOST_PATH=/tmp/web.key GATEWAY_TLS_CA_HOST_PATH=/tmp/gateway-ca.crt GATEWAY_TLS_CLIENT_CERT_HOST_PATH=/tmp/api-client.crt GATEWAY_TLS_CLIENT_KEY_HOST_PATH=/tmp/api-client.key GATEWAY_TLS_SERVER_CERT_HOST_PATH=/tmp/gateway-server.crt GATEWAY_TLS_SERVER_KEY_HOST_PATH=/tmp/gateway-server.key docker compose -p vpngwgui $files config --format json)
      printf '%s' "$config" | WEB_TLS="$web_tls" GATEWAY_TLS="$gateway_tls" VENDOR_SET="$vendor_set" node --input-type=module -e '
        let input = "";
        for await (const chunk of process.stdin) input += chunk;
        const config = JSON.parse(input);
        const enabled = (service, name) => (service.environment ?? {})[name];
        const mounts = (service) => service.volumes ?? [];
        const web = config.services.web;
        const api = config.services.api;
        const proxy = config.services.proxy;
        for (const name of ["web", "api", "proxy"]) if (!config.services[name]) throw new Error(`root service ${name} missing`);
        if ((api.ports ?? []).length !== 0 || (proxy.ports ?? []).length !== 0) throw new Error("API and Gateway must not publish ports");
        if (web.ports?.length !== 1 || web.ports[0].target !== 8080 || web.ports[0].published !== (process.env.WEB_PORT ?? "8080")) throw new Error("web published port contract changed");
        if (!config.networks?.["app-net"]) throw new Error("app-net missing");
        for (const name of ["api-data", "gateway-socket", "ctl-socket"]) if (!config.volumes?.[name]) throw new Error(`root volume ${name} missing`);
        if (proxy.network_mode !== "host" || !(proxy.cap_add ?? []).includes("NET_ADMIN")) throw new Error("proxy host networking or NET_ADMIN contract changed");
        const expectedVendors = { none: [], proton: ["runner-protonvpn"], adguard: ["runner-adguardvpn"], both: ["runner-protonvpn", "runner-adguardvpn"] }[process.env.VENDOR_SET];
        for (const runner of ["runner-protonvpn", "runner-adguardvpn"]) if (Boolean(config.services[runner]) !== expectedVendors.includes(runner)) throw new Error(`unexpected runner ${runner}`);
        const webTls = process.env.WEB_TLS === "true";
        const gatewayTls = process.env.GATEWAY_TLS === "true";
        if (enabled(web, "WEB_HTTPS_ENABLED") !== String(webTls)) throw new Error("web flag mismatch");
        if (enabled(api, "WEB_HTTPS_ENABLED") !== String(webTls)) throw new Error("api cookie flag mismatch");
        if (enabled(api, "GATEWAY_TLS_ENABLED") !== String(gatewayTls) || enabled(proxy, "GATEWAY_TLS_ENABLED") !== String(gatewayTls)) throw new Error("gateway flags must match");
        if ((proxy.ports ?? []).length !== 0) throw new Error("Gateway proxy must not publish a TCP control port");
        const gatewaySocketMounts = mounts(api).filter((mount) => mount.target === "/run/vpngw-gateway");
        const proxySocketMounts = mounts(proxy).filter((mount) => mount.target === "/run/vpngw-gateway");
        if (gatewaySocketMounts.length !== 1 || proxySocketMounts.length !== 1 || gatewaySocketMounts[0].source !== proxySocketMounts[0].source) throw new Error("API and Gateway must share one UDS volume");
        const webCertMounts = mounts(web).filter((mount) => mount.target.startsWith("/run/vpngwgui/web-tls/"));
        const apiCertMounts = mounts(api).filter((mount) => mount.target.startsWith("/run/vpngwgui/gateway-tls/"));
        const proxyCertMounts = mounts(proxy).filter((mount) => mount.target.startsWith("/run/vpngwgui/gateway-tls/"));
        if (webCertMounts.length !== (webTls ? 2 : 0)) throw new Error("web TLS mount does not follow its flag");
        if (apiCertMounts.length !== (gatewayTls ? 3 : 0) || proxyCertMounts.length !== (gatewayTls ? 3 : 0)) throw new Error("gateway TLS mounts do not follow their flag");
        if (webTls && (!enabled(web, "WEB_TLS_CERT_FILE") || !enabled(web, "WEB_TLS_KEY_FILE"))) throw new Error("web TLS file paths missing");
        if (gatewayTls && ["GATEWAY_TLS_CA_FILE", "GATEWAY_TLS_CLIENT_CERT_FILE", "GATEWAY_TLS_CLIENT_KEY_FILE"].some((name) => !enabled(api, name))) throw new Error("gateway API TLS paths missing");
        if (gatewayTls && ["GATEWAY_TLS_CA_FILE", "GATEWAY_TLS_CERT_FILE", "GATEWAY_TLS_KEY_FILE"].some((name) => !enabled(proxy, name))) throw new Error("gateway server TLS paths missing");
        if (gatewayTls && api.environment.GATEWAY_TLS_CERT_FILE !== undefined) throw new Error("legacy API TLS certificate path remains");
        if (gatewayTls && api.environment.GATEWAY_TLS_KEY_FILE !== undefined) throw new Error("legacy API TLS key path remains");
        if (gatewayTls && proxyCertMounts.every((mount) => mount.target !== "/run/vpngwgui/gateway-tls/ca.crt")) throw new Error("Gateway CA is not mounted into proxy");
      '
    done
  done
done
