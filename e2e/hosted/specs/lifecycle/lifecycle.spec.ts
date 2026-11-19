// 責務: hosted lifecycle 群で root Compose、TLS matrix、vendor fragment の構成を検証する。

import { test, expect } from "@playwright/test";
import { composeConfig, HOSTED_COMPOSE_FRAGMENTS } from "../../fixtures/compose.js";

test.describe("Compose lifecycle configuration", () => {
  test("root Compose は HTTP / no-cert を既定にする", () => {
    const base = composeConfig();
    expect(base.name).toBe("vpngwgui");
    expect(base.services.web.environment.WEB_HTTPS_ENABLED).toBe("false");
    expect(base.services.web.volumes ?? []).toEqual([]);
    expect(base.services.api.volumes?.some((volume) => volume.target?.includes("gateway-tls"))).toBe(false);

    expect(base.volumes["api-data"].name).toBe("vpngwgui_api-data");
  });

  test("vendor fragment を外して再選択しても data volume 名を再利用する", () => {
    const selected = composeConfig(HOSTED_COMPOSE_FRAGMENTS);
    const detached = composeConfig(["docker-compose.e2e-mock.yml"]);
    const reselected = composeConfig(HOSTED_COMPOSE_FRAGMENTS);

    expect(selected.volumes["api-data"].name).toBe(detached.volumes["api-data"].name);
    expect(selected.volumes["proton-config"].name).toBe(reselected.volumes["proton-config"].name);
    expect(selected.volumes["adguard-data"].name).toBe(reselected.volumes["adguard-data"].name);

  });
});
