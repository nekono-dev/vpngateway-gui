#!/bin/sh
# 責務: TLS override fragment の独立性と証明書 mount 条件を検証する。
set -eu

root_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir"

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

for vendor in '' vendors/protonvpn/compose.yml vendors/adguardvpn/compose.yml; do
  for web_tls in false true; do
    for gateway_tls in false true; do
      files='-f docker-compose.yml'
      if [ -n "$vendor" ]; then files="$files -f $vendor"; fi
      if [ "$web_tls" = true ]; then files="$files -f compose/web-tls.yml"; fi
      if [ "$gateway_tls" = true ]; then files="$files -f compose/api-tls.yml"; fi
      # shellcheck disable=SC2086
      config=$(WEB_HTTPS_ENABLED="$web_tls" GATEWAY_TLS_ENABLED="$gateway_tls" WEB_TLS_CERT_HOST_PATH=/tmp/web.crt WEB_TLS_KEY_HOST_PATH=/tmp/web.key GATEWAY_TLS_CA_HOST_PATH=/tmp/gateway-ca.crt GATEWAY_TLS_CLIENT_CERT_HOST_PATH=/tmp/api-client.crt GATEWAY_TLS_CLIENT_KEY_HOST_PATH=/tmp/api-client.key GATEWAY_TLS_SERVER_CERT_HOST_PATH=/tmp/gateway-server.crt GATEWAY_TLS_SERVER_KEY_HOST_PATH=/tmp/gateway-server.key docker compose -p vpngwgui $files config --format json)
      printf '%s' "$config" | WEB_TLS="$web_tls" GATEWAY_TLS="$gateway_tls" node --input-type=module -e '
        let input = "";
        for await (const chunk of process.stdin) input += chunk;
        const config = JSON.parse(input);
        const enabled = (service, name) => (service.environment ?? {})[name];
        const mounts = (service) => service.volumes ?? [];
        const web = config.services.web;
        const api = config.services.api;
        const proxy = config.services.proxy;
        const webTls = process.env.WEB_TLS === "true";
        const gatewayTls = process.env.GATEWAY_TLS === "true";
        if (enabled(web, "WEB_HTTPS_ENABLED") !== String(webTls)) throw new Error("web flag mismatch");
        if (enabled(api, "WEB_HTTPS_ENABLED") !== String(webTls)) throw new Error("api cookie flag mismatch");
        if (enabled(api, "GATEWAY_TLS_ENABLED") !== String(gatewayTls) || enabled(proxy, "GATEWAY_TLS_ENABLED") !== String(gatewayTls)) throw new Error("gateway flags must match");
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
