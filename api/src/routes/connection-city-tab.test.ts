// 責務: 都市一覧タブ API の取得・保存・入力検証を統合テストする。
import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-city-tab-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "protonvpn,adguardvpn";
process.env.STATE_DIR = dir;
process.env.PROVIDER_CACHE_DIR = join(dir, "cache");
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");

const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
const { saveActiveProviderId } = await import("../providers/active-provider-store.js");
const { resetProviderRegistryForTest } = await import("../providers/provider-registry.js");
const app = withAuthenticatedInject(buildRawApp());
const tabFile = join(dir, "providers", "protonvpn", "city-tab.json");

describe("/v1/connection/city-tab", () => {
  beforeEach(() => {
    process.env.ENABLED_PROVIDERS = "protonvpn,adguardvpn";
    resetProviderRegistryForTest();
    saveActiveProviderId("protonvpn");
    rmSync(tabFile, { force: true });
  });

  it("未保存なら既定値 fastest を返す", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/connection/city-tab" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tab: "fastest" });
  });

  it("select を保存すると取得結果に反映する", async () => {
    const saved = await app.inject({ method: "PUT", url: "/v1/connection/city-tab", payload: { tab: "select" } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ tab: "select" });
    const read = await app.inject({ method: "GET", url: "/v1/connection/city-tab" });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ tab: "select" });
  });

  it.each(["server", "x"])("不正なタブ %s は 400", async (tab) => {
    const response = await app.inject({ method: "PUT", url: "/v1/connection/city-tab", payload: { tab } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_input" });
  });
});
