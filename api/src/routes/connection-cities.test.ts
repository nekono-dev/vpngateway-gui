// 責務: GET /v1/connection/locations/:country/cities の取得・キャッシュ・距離注釈を統合検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-cities-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "protonvpn,adguardvpn";
process.env.STATE_DIR = dir;
process.env.PROVIDER_CACHE_DIR = join(dir, "cache");
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
const { executeVendorCommandMock } = vi.hoisted(() => ({ executeVendorCommandMock: vi.fn() }));
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => executeVendorCommandMock(input, providerId),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: async () => true,
}));
const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
const app = withAuthenticatedInject(buildRawApp());
const { saveActiveProviderId } = await import("../providers/active-provider-store.js");
const { resetProviderRegistryForTest } = await import("../providers/provider-registry.js");
const { addFavoriteLocationItem } = await import("../locations/favorite-locations-store.js");
const { saveUserCountry } = await import("../locations/user-location-store.js");
const { readCityList } = await import("../locations/city-cache-store.js");
const JAPAN = "\nCities in Japan:\nCity    Features\n------  ----------\nOsaka   P2P\nTokyo   P2P\n\n";

describe("GET /v1/connection/locations/:country/cities", () => {
  beforeEach(() => {
    process.env.ENABLED_PROVIDERS = "protonvpn,adguardvpn";
    resetProviderRegistryForTest();
    saveActiveProviderId("protonvpn");
    rmSync(join(dir, "providers"), { recursive: true, force: true });
    executeVendorCommandMock.mockReset().mockResolvedValue({ exitCode: 0, stdout: JAPAN, stderr: "" });
  });

  it("都市を含む一覧を返すプロバイダは一覧から都市を取得・再取得する", async () => {
    saveActiveProviderId("adguardvpn");
    executeVendorCommandMock.mockResolvedValue({ exitCode: 0, stdout: "ISO   COUNTRY              CITY                           PING ESTIMATE\nJP    Japan                Tokyo                          4\n", stderr: "" });
    for (const method of ["GET", "POST"] as const) {
      const response = await app.inject({ method, url: `/v1/connection/locations/jp/cities${method === "POST" ? "/refresh" : ""}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([expect.objectContaining({ id: "jp-tokyo", city: "Tokyo", pingMs: 4 })]);
    }
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(2);
  });

  it("初回は CLI で取得して保存し、再訪時はキャッシュを返す", async () => {
    const first = await app.inject({ method: "GET", url: "/v1/connection/locations/jp/cities" });
    const second = await app.inject({ method: "GET", url: "/v1/connection/locations/jp/cities" });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(readCityList("protonvpn", "jp")).toEqual(["Osaka", "Tokyo"]);
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(1);
    expect(executeVendorCommandMock.mock.calls[0][0]).toMatchObject({ resolvedArgv: ["cities", "list", "--country", "JP"] });
  });

  it("取得失敗をエラー応答にする", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 11, stdout: "not logged in", stderr: "" });
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/jp/cities" });
    expect(response.statusCode).toBe(422);
  });

  it("再取得は保存済み一覧を CLI で取り直して更新する", async () => {
    const initial = await app.inject({ method: "GET", url: "/v1/connection/locations/jp/cities" });
    expect(initial.statusCode).toBe(200);
    executeVendorCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "\nCities in Japan:\nCity    Features\n------  ----------\nKyoto   P2P\n\n",
      stderr: "",
    });

    const refreshed = await app.inject({ method: "POST", url: "/v1/connection/locations/jp/cities/refresh" });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().map((row: { city: string }) => row.city)).toEqual(["Kyoto"]);
    expect(readCityList("protonvpn", "jp")).toEqual(["Kyoto"]);
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(2);
    expect(executeVendorCommandMock.mock.calls[1][0]).toMatchObject({ resolvedArgv: ["cities", "list", "--country", "JP"] });
  });

  it("再取得の CLI 失敗をエラー応答にする", async () => {
    await app.inject({ method: "GET", url: "/v1/connection/locations/jp/cities" });
    executeVendorCommandMock.mockResolvedValueOnce({ exitCode: 11, stdout: "not logged in", stderr: "" });

    const response = await app.inject({ method: "POST", url: "/v1/connection/locations/jp/cities/refresh" });

    expect(response.statusCode).toBe(422);
    expect(readCityList("protonvpn", "jp")).toEqual(["Osaka", "Tokyo"]);
  });

  it("距離を付けて距離順にし、お気に入りを先頭へ置く", async () => {
    saveUserCountry("JP");
    addFavoriteLocationItem("protonvpn", { id: "jp-tokyo", kind: "city", country: "jp", countryName: "Japan", city: "Tokyo" });
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/jp/cities" });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((row: { city: string }) => row.city)).toEqual(["Tokyo", "Osaka"]);
    expect(response.json().every((row: { distanceKm?: number }) => typeof row.distanceKm === "number")).toBe(true);
    expect(response.json()[0]).toMatchObject({ favorite: true });
  });

  it("プラン制限の失敗を403にする", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 1, stdout: "not available on the free plan", stderr: "" });
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations/jp/cities" });
    expect(response.statusCode).toBe(403);
  });
});
