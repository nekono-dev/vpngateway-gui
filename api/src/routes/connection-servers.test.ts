// 責務: GET /v1/connection/locations/:cityId/servers の統合テスト。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-servers-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "protonvpn,adguardvpn";
process.env.STATE_DIR = dir;
process.env.PROVIDER_CACHE_DIR = join(dir, "cache");
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");

const { commandMock } = vi.hoisted(() => ({ commandMock: vi.fn() }));
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (...args: unknown[]) => commandMock(...args),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: async () => true,
}));
const { saveLastLocationId } = await import("../locations/last-location-store.js");

const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
const { saveActiveProviderId } = await import("../providers/active-provider-store.js");
const { resetProviderRegistryForTest } = await import("../providers/provider-registry.js");
const app = withAuthenticatedInject(buildRawApp());

function writeCatalog() {
  const providerDir = join(process.env.PROVIDER_CACHE_DIR!, "protonvpn", "VPN");
  mkdirSync(providerDir, { recursive: true });
  writeFileSync(join(providerDir, "serverlist.json"), JSON.stringify({ LogicalServers: [
    { Name: "JP-TOK#3", ExitCountry: "JP", City: "Tokyo", Tier: 1, Features: 0, Status: 1, Score: 30, Load: 50 },
    { Name: "JP-TOK#1", ExitCountry: "JP", City: "Tokyo", Tier: 0, Features: 0, Status: 1, Score: 10, Load: 20 },
    { Name: "JP-CORE#1", ExitCountry: "JP", City: "Tokyo", Tier: 1, Features: 1, Status: 1, Score: 1, Load: 10 },
    { Name: "JP-DOWN#1", ExitCountry: "JP", City: "Tokyo", Tier: 1, Features: 0, Status: 0, Score: 2, Load: 10 },
  ] }));
}

describe("GET /v1/connection/locations/:cityId/servers", () => {
  beforeEach(() => {
    process.env.ENABLED_PROVIDERS = "protonvpn,adguardvpn";
    resetProviderRegistryForTest();
    saveActiveProviderId("protonvpn");
    rmSync(process.env.PROVIDER_CACHE_DIR!, { recursive: true, force: true });
    writeCatalog();
    commandMock.mockReset().mockResolvedValue({ exitCode: 0, stdout: "Status: Disconnected\n", stderr: "" });
  });

  it("有効な非 Secure Core サーバのみを Score 昇順で返す", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/jp-tokyo/servers" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { name: "JP-TOK#1", tier: "free", load: 20, score: 10, favorite: false, connected: false },
      { name: "JP-TOK#3", tier: "paid", load: 50, score: 30, favorite: false, connected: false },
    ]);
  });

  it("都市接続でも実際のサーバだけを接続中とし、切断後は前回サーバを接続中にしない", async () => {
    saveLastLocationId("protonvpn", "jp-tokyo");
    commandMock.mockResolvedValue({ exitCode: 0, stdout: "Status: Connected\nServer: JP-TOK#3 in Tokyo, Japan\n", stderr: "" });
    const connected = await app.inject({ method: "GET", url: "/v1/connection/locations/jp-tokyo/servers" });
    expect(connected.statusCode).toBe(200);
    expect(connected.json().map((row: { connected: boolean }) => row.connected)).toEqual([false, true]);
    saveLastLocationId("protonvpn", "srv-jp-tok-3");
    commandMock.mockResolvedValue({ exitCode: 0, stdout: "Status: Disconnected\n", stderr: "" });
    const disconnected = await app.inject({ method: "GET", url: "/v1/connection/locations/jp-tokyo/servers" });
    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json().every((row: { connected: boolean }) => !row.connected)).toBe(true);
  });

  it("状態取得に失敗しても前回の接続先を接続中として返さない", async () => {
    saveLastLocationId("protonvpn", "srv-jp-tok-1");
    commandMock.mockRejectedValue(new Error("status unavailable"));
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/jp-tokyo/servers" });
    expect(response.statusCode).toBe(200);
    expect(response.json().every((row: { connected: boolean }) => !row.connected)).toBe(true);
  });

  it("serverCatalog のない AdGuard VPN では 404", async () => {
    saveActiveProviderId("adguardvpn");
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/jp-tokyo/servers" });
    expect(response.statusCode).toBe(404);
  });

  it("不正な都市 ID は 400", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/Tokyo/servers" });
    expect(response.statusCode).toBe(400);
  });

  it("形式は正しいが存在しない都市は 404", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/jp-nosuchcity/servers" });
    expect(response.statusCode).toBe(404);
  });
});
