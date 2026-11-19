#!/bin/sh
# 責務: root Compose と vendor fragment の merge 契約を検証する。
set -eu

root_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir"

for legacy_fragment in compose/web.yml compose/api.yml compose/gateway.yml; do
  if [ -e "$legacy_fragment" ]; then
    printf '分離配置用 Compose fragment が残っています: %s\n' "$legacy_fragment" >&2
    exit 1
  fi
done

expected_volumes=''
proton_volumes=''
adguard_volumes=''
for fragment in '' vendors/protonvpn/compose.yml vendors/adguardvpn/compose.yml vendors/protonvpn/compose.yml vendors/adguardvpn/compose.yml; do
  if [ -n "$fragment" ]; then
    docker compose -p vpngwgui -f docker-compose.yml -f "$fragment" config --quiet
    config=$(docker compose -p vpngwgui -f docker-compose.yml -f "$fragment" config --format json)
  else
    docker compose -p vpngwgui -f docker-compose.yml config --quiet
    config=$(docker compose -p vpngwgui -f docker-compose.yml config --format json)
  fi
  case "$fragment" in
    vendors/protonvpn/compose.yml) expected_runner=runner-protonvpn ;;
    vendors/adguardvpn/compose.yml) expected_runner=runner-adguardvpn ;;
    *) expected_runner=none ;;
  esac
  # shellcheck disable=SC2016
  current_volumes=$(printf '%s' "$config" | EXPECTED_RUNNER="$expected_runner" node --input-type=module -e '
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const config = JSON.parse(input);
    const services = config.services;
    const expected = ["web", "api", "proxy"];
    for (const name of expected) if (!services[name]) throw new Error(`missing service ${name}`);
    for (const name of expected) {
      if (services[name].restart !== "always") throw new Error(`${name} restart policy changed`);
      if (services[name].build?.context !== process.cwd()) throw new Error(`${name} build context changed`);
      if (services[name].build?.args) throw new Error(`${name} must not require legacy build args`);
    }
    if (services.web.build.dockerfile !== "web/Dockerfile" || services.api.build.dockerfile !== "api/Dockerfile" || services.proxy.build.dockerfile !== "proxy/Dockerfile") {
      throw new Error("service Dockerfile mapping changed");
    }
    if (services.web.environment.API_ORIGIN !== "http://api:3000") throw new Error("web must use the root Compose internal HTTP API origin");
    if (services.api.user !== "10001:10001") throw new Error("api service user changed");
    if (services.proxy.init !== true || !(services.proxy.cap_add ?? []).includes("NET_ADMIN")) throw new Error("proxy init/capability contract changed");
    if (services.proxy.environment.DNS_RELAY_PORT !== (process.env.DNS_RELAY_PORT ?? "53")) throw new Error("proxy DNS relay default changed");
    if (services.proxy.environment.LAN_IFACE !== (process.env.LAN_IFACE ?? "")) throw new Error("proxy LAN_IFACE default changed");
    const webPorts = services.web.ports ?? [];
    const configuredWebPort = process.env.WEB_PORT ?? "8080";
    if (webPorts.length !== 1 || webPorts[0].target !== 8080 || webPorts[0].published !== configuredWebPort) {
      throw new Error("web must publish configured WEB_PORT (default 8080) to 8080");
    }
    if ((services.api.ports ?? []).length !== 0) throw new Error("api must not publish ports");
    if (!Object.hasOwn(services.api.networks ?? {}, "app-net")) throw new Error("api must attach to app-net");
    if (services.proxy.network_mode !== "host") throw new Error("proxy must use host networking");
    if ((services.proxy.ports ?? []).length !== 0) throw new Error("proxy must not publish TCP control ports");
    const mounts = new Set(services.proxy.volumes.map((mount) => `${mount.source}:${mount.target}`));
    if (!mounts.has("ctl-socket:/var/run/vpngw-ctl")) throw new Error("runner control socket mount missing");
    if (!mounts.has("gateway-socket:/run/vpngw-gateway")) throw new Error("gateway socket mount missing");
    const apiMounts = new Set(services.api.volumes.map((mount) => `${mount.source}:${mount.target}`));
    if (!apiMounts.has("api-data:/var/lib/vpngwgui")) throw new Error("api persistent data mount missing");
    if (services.api.volumes.some((mount) => mount.source === "ctl-socket")) throw new Error("api must not mount runner socket");
    if (!services.api.volumes.some((mount) => mount.source === "gateway-socket")) throw new Error("api gateway socket mount missing");
    const hostCtlMount = services.proxy.volumes.find((mount) => mount.target === "/var/run/vpngw-host-ctl");
    if (!hostCtlMount || hostCtlMount.type !== "bind" || hostCtlMount.source !== "/var/lib/vpngwgui-host-ctl" || hostCtlMount.read_only) {
      throw new Error("proxy must read-write bind mount /var/lib/vpngwgui-host-ctl to /var/run/vpngw-host-ctl");
    }
    for (const serviceName of ["api", "web"]) {
      if ((services[serviceName].volumes ?? []).some((mount) => mount.target === "/var/run/vpngw-host-ctl" || mount.source === "/var/lib/vpngwgui-host-ctl")) {
        throw new Error(`${serviceName} must not mount host reboot control directory`);
      }
    }
    if (!config.networks?.["app-net"]) throw new Error("app-net missing");
    for (const volume of ["api-data", "gateway-socket", "ctl-socket"]) {
      if (!config.volumes?.[volume]) throw new Error(`named volume ${volume} missing`);
      if (config.volumes[volume].name !== `vpngwgui_${volume}`) throw new Error(`volume ${volume} is not project-stable`);
    }
    const expectedRunner = process.env.EXPECTED_RUNNER;
    for (const runner of ["runner-protonvpn", "runner-adguardvpn"]) {
      if (Boolean(services[runner]) !== (runner === expectedRunner)) throw new Error(`unexpected runner state for ${runner}`);
    }
    const common = ["api-data", "gateway-socket", "ctl-socket"].map((volume) => config.volumes[volume].name);
    const vendorVolumes = expectedRunner === "runner-protonvpn"
      ? ["proton-config", "proton-keyrings", "proton-cache"].map((volume) => {
          if (!config.volumes?.[volume]) throw new Error(`vendor volume ${volume} missing`);
          return config.volumes[volume].name;
        })
      : expectedRunner === "runner-adguardvpn"
        ? ["adguard-data"].map((volume) => {
            if (!config.volumes?.[volume]) throw new Error(`vendor volume ${volume} missing`);
            return config.volumes[volume].name;
          })
        : [];
    process.stdout.write([...common, ...vendorVolumes].join(" "));
  ')
  common_volumes=$(printf '%s\n' "$current_volumes" | cut -d ' ' -f 1-3)
  if [ -z "$expected_volumes" ]; then expected_volumes=$common_volumes; fi
  if [ "$expected_volumes" != "$common_volumes" ]; then
    printf '%s\n' "Compose common volume names changed across merge: $current_volumes" >&2
    exit 1
  fi
  case "$fragment" in
    vendors/protonvpn/compose.yml)
      current_vendor_volumes=$(printf '%s\n' "$current_volumes" | cut -d ' ' -f 4-6)
      if [ -z "$proton_volumes" ]; then proton_volumes=$current_vendor_volumes; fi
      if [ "$proton_volumes" != "$current_vendor_volumes" ]; then
        printf '%s\n' "Proton persistent volume names changed after fragment re-add: $current_vendor_volumes" >&2
        exit 1
      fi
      ;;
    vendors/adguardvpn/compose.yml)
      current_vendor_volumes=$(printf '%s\n' "$current_volumes" | cut -d ' ' -f 4-)
      if [ -z "$adguard_volumes" ]; then adguard_volumes=$current_vendor_volumes; fi
      if [ "$adguard_volumes" != "$current_vendor_volumes" ]; then
        printf '%s\n' "AdGuard persistent volume names changed after fragment re-add: $current_vendor_volumes" >&2
        exit 1
      fi
      ;;
  esac
done

# Compose が参照しない環境変数は構成エラーにしない。
unused_key_for_compose_contract=ignored
export unused_key_for_compose_contract
docker compose -p vpngwgui -f docker-compose.yml config --quiet
