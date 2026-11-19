// 責務: hosted Compose fixture の project 固定と volume 命名契約を検証する。

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { composeArgs, composeConfig, composeDown, composeDownVolumes, composeUp, type ComposeConfig } from "./compose.js";

describe("hosted Compose fixture", () => {
  it("全 lifecycle 呼び出しで固定 project を明示し、fragment を root の後ろに並べる", () => {
    expect(composeArgs(["down", "-v"], ["vendors/protonvpn/compose.yml", "compose/web-tls.yml"])).toEqual([
      "compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "-f", "vendors/protonvpn/compose.yml", "-f", "compose/web-tls.yml", "down", "-v",
    ]);
    expect(composeArgs(["up", "-d"])).toEqual(["compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "up", "-d"]);
    expect(composeArgs(["down"])).toEqual(["compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "down"]);
    expect(composeArgs(["down", "-v"])).toEqual(["compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "down", "-v"]);
  });

  it("CLI project 名は name と COMPOSE_PROJECT_NAME を上書きし、別名は volume 名を変える", () => {
    const fixed = composeConfig([], { COMPOSE_PROJECT_NAME: "environment-name" });
    const alternate = composeConfig([], {}, "alternate");
    const envOverride = JSON.parse(execFileSync("docker", ["compose", "-f", "docker-compose.yml", "config", "--format", "json"], {
      encoding: "utf8",
      env: { ...process.env, COMPOSE_PROJECT_NAME: "environment-name" },
    })) as typeof fixed;

    expect(fixed.name).toBe("vpngwgui");
    expect(envOverride.name).toBe("environment-name");
    expect(alternate.name).toBe("alternate");
    expect(fixed.volumes["api-data"].name).toBe("vpngwgui_api-data");
    expect(envOverride.volumes["api-data"].name).toBe("environment-name_api-data");
    expect(alternate.volumes["api-data"].name).toBe("alternate_api-data");
  });

  it("TLS fragment がない構成は HTTP 既定で証明書 mount を持たない", () => {
    const config = composeConfig();
    expect(config.services.web.environment.WEB_HTTPS_ENABLED).toBe("false");
    expect(config.services.web.ports?.[0]).toMatchObject({ target: 8080, published: "8080", protocol: "tcp" });
    expect(config.services.web.volumes ?? []).toEqual([]);
    expect(config.services.api.volumes).not.toContainEqual(expect.objectContaining({ target: "/run/vpngwgui/gateway-tls/ca.crt" }));
  });

  it("vendor を保持したまま TLS fragment の4組み合わせを config で解決する", () => {
    const tlsEnv = {
      WEB_TLS_CERT_HOST_PATH: "/tmp/web.crt",
      WEB_TLS_KEY_HOST_PATH: "/tmp/web.key",
      GATEWAY_TLS_CA_HOST_PATH: "/tmp/gateway-ca.crt",
      GATEWAY_TLS_CLIENT_CERT_HOST_PATH: "/tmp/api-client.crt",
      GATEWAY_TLS_CLIENT_KEY_HOST_PATH: "/tmp/api-client.key",
      GATEWAY_TLS_SERVER_CERT_HOST_PATH: "/tmp/gateway-server.crt",
      GATEWAY_TLS_SERVER_KEY_HOST_PATH: "/tmp/gateway-server.key",
    };
    const vendorFragments = [[], ["vendors/protonvpn/compose.yml"], ["vendors/adguardvpn/compose.yml"]];
    const tlsCombinations: { fragments: string[]; env: NodeJS.ProcessEnv }[] = [
      { fragments: [], env: { WEB_HTTPS_ENABLED: "false", GATEWAY_TLS_ENABLED: "false" } },
      { fragments: ["compose/web-tls.yml"], env: { ...tlsEnv, WEB_HTTPS_ENABLED: "true", GATEWAY_TLS_ENABLED: "false" } },
      { fragments: ["compose/api-tls.yml"], env: { ...tlsEnv, WEB_HTTPS_ENABLED: "false", GATEWAY_TLS_ENABLED: "true" } },
      { fragments: ["compose/web-tls.yml", "compose/api-tls.yml"], env: { ...tlsEnv, WEB_HTTPS_ENABLED: "true", GATEWAY_TLS_ENABLED: "true" } },
    ];

    for (const vendor of vendorFragments) {
      for (const tls of tlsCombinations) {
        const config = composeConfig([...vendor, ...tls.fragments], tls.env);
        expect(config.name).toBe("vpngwgui");
        expect(config.volumes["api-data"].name).toBe("vpngwgui_api-data");
        expect(config.services.web.environment.WEB_HTTPS_ENABLED).toBe(tls.env.WEB_HTTPS_ENABLED);
        expect(config.services.api.environment.GATEWAY_TLS_ENABLED).toBe(tls.env.GATEWAY_TLS_ENABLED);
        expect(config.services.web.volumes?.some((volume) => volume.target?.includes("web-tls")) ?? false).toBe(tls.fragments.includes("compose/web-tls.yml"));
        expect(config.services.api.volumes?.some((volume) => volume.target?.includes("gateway-tls")) ?? false).toBe(tls.fragments.includes("compose/api-tls.yml"));
      }
    }
  });

  it("vendor fragment を外しても再選択しても同じ project volume 名になる", () => {
    const firstSelection = composeConfig(["vendors/protonvpn/compose.yml"]);
    const detached = composeConfig();
    const reselected = composeConfig(["vendors/protonvpn/compose.yml"]);

    expect(firstSelection.volumes["api-data"].name).toBe(detached.volumes["api-data"].name);
    expect(firstSelection.volumes["proton-config"].name).toBe(reselected.volumes["proton-config"].name);
  });

  it("Compose lifecycle を注入 runner 経由で実行し、失敗時はログ確認の手掛かりを含める", () => {
    const calls: { file: string; args: string[] }[] = [];
    const runner = (file: string, args: readonly string[]): string => {
      calls.push({ file, args: [...args] });
      return "ok";
    };
    const fragments = ["vendors/protonvpn/compose.yml", "docker-compose.e2e-mock.yml"];

    expect(composeUp(fragments, runner)).toBe("ok");
    expect(composeDown(fragments, runner)).toBe("ok");
    expect(composeDownVolumes(fragments, runner)).toBe("ok");
    expect(calls).toEqual([
      { file: "docker", args: ["compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "-f", fragments[0], "-f", fragments[1], "config", "--quiet"] },
      { file: "docker", args: ["compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "-f", fragments[0], "-f", fragments[1], "up", "-d", "--build"] },
      { file: "docker", args: ["compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "-f", fragments[0], "-f", fragments[1], "down"] },
      { file: "docker", args: ["compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "-f", fragments[0], "-f", fragments[1], "down", "-v"] },
    ]);
    let failedAtUp = false;
    const failingRunner = (_file: string, args: readonly string[]): string => {
      if (args.includes("up")) {
        failedAtUp = true;
        throw new Error("exit status 1");
      }
      return "ok";
    };
    expect(() => composeUp(fragments, failingRunner)).toThrow(/docker compose .* logs/);
    expect(failedAtUp).toBe(true);
  });

  it("COMPOSE_PROJECT_NAME と -p は Compose の name を上書きする", () => {
    const envOverride = JSON.parse(execFileSync("docker", ["compose", "-f", "docker-compose.yml", "config", "--format", "json"], {
      encoding: "utf8",
      env: { ...process.env, COMPOSE_PROJECT_NAME: "environment-name" },
    })) as ComposeConfig;
    const cliOverride = composeConfig([], { COMPOSE_PROJECT_NAME: "environment-name" }, "cli-name");
    expect(envOverride.name).toBe("environment-name");
    expect(cliOverride.name).toBe("cli-name");
    expect(cliOverride.volumes["api-data"].name).toBe("cli-name_api-data");
  });
});
