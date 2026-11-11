// 責務: GET /v1/connection/locations と、お気に入り登録・解除の統合テスト（プロキシ通信はモック）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ProxyUnavailableError } from "../errors.js";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
process.env.STATE_DIR = dir;
process.env.PROVIDER_CACHE_DIR = join(dir, "cache");
/** AdGuard VPNのベンダー別状態ファイルのパス。 */
const statePath = (name: string) => join(dir, "providers", "adguardvpn", name);

const { executeVendorCommandMock } = vi.hoisted(() => ({ executeVendorCommandMock: vi.fn() }));
// 第1引数を入力、第2引数をベンダーIDとして記録する（呼び出し内容の検証を、入力を先頭にして書けるようにするため）。
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => executeVendorCommandMock(input, providerId),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: async () => true,
}));

const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
// Phase 25で追加した/v1/*の認可により、認証無しのapp.injectは401になるため、
// 既存の統合テストはログイン済みCookie付きのinjectへ差し替えて呼び出す。
function buildApp() {
  return withAuthenticatedInject(buildRawApp());
}
const { saveLastLocationId } = await import("../locations/last-location-store.js");
const { readCityList, saveCityList } = await import("../locations/city-cache-store.js");

// 実CLIはping昇順で返すが、APIが整列する（順序をCLI任せにしない）ことを検証するため、あえて崩して並べる。
const LIST_OUTPUT =
  "\x1B[1mISO   COUNTRY              CITY                           PING ESTIMATE\n\x1B[0m" +
  "US    United States        Las Vegas                      111       \n" +
  "JP    Japan                Tokyo                          4         \n" +
  "CN    China                Shanghai (Virtual)             59        \n" +
  "\nYou can connect to a location by running `adguardvpn-cli connect -l 'city, country or ISO code'`\n";

describe("/v1/connection/locations", () => {
  const app = buildApp();

  beforeEach(() => {
    executeVendorCommandMock.mockReset();
    executeVendorCommandMock.mockResolvedValue({ exitCode: 0, stdout: LIST_OUTPUT, stderr: "" });
    rmSync(statePath("favorite-locations.json"), { force: true });
    rmSync(statePath("last-location.json"), { force: true });
  });

  it("国の行を都市の最小ping順で返し、国行にpingを含めない", async () => {
    saveLastLocationId("adguardvpn", "jp-tokyo");
    await app.inject({ method: "PUT", url: "/v1/connection/locations/cn-shanghai-virtual/favorite", payload: { id: "cn-shanghai-virtual", kind: "city", country: "cn", countryName: "China", city: "Shanghai (Virtual)" } });

    const response = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(response.statusCode).toBe(200);
    const rows = response.json() as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.country)).toEqual(["jp", "cn", "us"]);
    expect(rows.every((row) => row.pingMs === undefined && row.city === undefined)).toBe(true);
    expect(rows.every((row) => row.hasServerStage === false)).toBe(true);
  });

  it("list-locationsを実行するのは、リクエストごと（キャッシュしない）", async () => {
    await app.inject({ method: "GET", url: "/v1/connection/locations" });
    await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(2);
    expect(executeVendorCommandMock.mock.calls[0][0]).toMatchObject({ resolvedArgv: ["list-locations"] });
  });

  it("再計測で都市の保存を破棄してから国一覧を取り直す", async () => {
    saveCityList("adguardvpn", "jp", ["Tokyo"]);
    saveCityList("adguardvpn", "us", ["Las Vegas"]);
    saveCityList("protonvpn", "jp", ["Tokyo"]);
    const catalog = join(process.env.PROVIDER_CACHE_DIR!, "adguardvpn", "serverlist.json");
    mkdirSync(join(process.env.PROVIDER_CACHE_DIR!, "adguardvpn"), { recursive: true });
    writeFileSync(catalog, "CLI owned catalog");
    const response = await app.inject({ method: "POST", url: "/v1/connection/locations/refresh" });
    expect(response.statusCode).toBe(200);
    expect(readCityList("adguardvpn", "jp")).toBeUndefined();
    expect(readCityList("adguardvpn", "us")).toBeUndefined();
    expect(readCityList("protonvpn", "jp")).toEqual(["Tokyo"]);
    expect(readFileSync(catalog, "utf8")).toBe("CLI owned catalog");
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(1);
    expect(executeVendorCommandMock.mock.calls[0][0]).toMatchObject({ resolvedArgv: ["list-locations"] });
  });

  it("コマンド失敗（未ログイン等）は422でstdoutを診断として返す", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 11, stdout: "You are not logged in\n", stderr: "" });
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ exitCode: 11, stderr: "You are not logged in" });
  });

  it("プロキシ未応答は502", async () => {
    executeVendorCommandMock.mockRejectedValue(new ProxyUnavailableError("down"));
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(response.statusCode).toBe(502);
  });

  it("お気に入りの登録・解除は冪等で、一覧の再取得後も保持される", async () => {
    const city = { id: "us-las-vegas", kind: "city", country: "us", countryName: "United States", city: "Las Vegas" };
    const add = await app.inject({ method: "PUT", url: "/v1/connection/locations/us-las-vegas/favorite", payload: city });
    expect(add.json()).toEqual({ locationId: "us-las-vegas", favorite: true });
    await app.inject({ method: "PUT", url: "/v1/connection/locations/us-las-vegas/favorite", payload: city });

    const server = { id: "srv-us-il-1", kind: "server", country: "us", countryName: "United States", city: "Chicago", serverName: "US-IL#1" };
    const serverAdd = await app.inject({ method: "PUT", url: "/v1/connection/locations/srv-us-il-1/favorite", payload: server });
    expect(serverAdd.statusCode, JSON.stringify(serverAdd.json())).toBe(200);
    const favorites = await app.inject({ method: "GET", url: "/v1/connection/favorites" });
    expect(favorites.json()).toEqual([city, server]);

    const listed = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(listed.json().every((l: { favorite: boolean }) => !l.favorite)).toBe(true);

    const removed = await app.inject({ method: "DELETE", url: "/v1/connection/locations/us-las-vegas/favorite" });
    expect(removed.json()).toEqual({ locationId: "us-las-vegas", favorite: false });
    await app.inject({ method: "DELETE", url: "/v1/connection/locations/us-las-vegas/favorite" });
    const after = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(after.json().some((l: { favorite: boolean }) => l.favorite)).toBe(false);
    const serverRemoved = await app.inject({ method: "DELETE", url: "/v1/connection/locations/srv-us-il-1/favorite" });
    expect(serverRemoved.json()).toEqual({ locationId: "srv-us-il-1", favorite: false });
    const finalFavorites = await app.inject({ method: "GET", url: "/v1/connection/favorites" });
    expect(finalFavorites.json()).toEqual([]);
  });

  it("形式不正な接続先IDのお気に入り操作は400", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/connection/locations/Tokyo/favorite", payload: { id: "Tokyo", kind: "city", country: "jp", countryName: "Japan", city: "Tokyo" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_input" });
  });

  it("city としてサーバIDを登録できない", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/connection/locations/srv-us-il-1/favorite", payload: { id: "srv-us-il-1", kind: "city", country: "us", countryName: "United States", city: "Chicago" } });
    expect(response.statusCode).toBe(400);
  });

  it("server として都市IDを登録できない", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/connection/locations/jp-tokyo/favorite", payload: { id: "jp-tokyo", kind: "server", country: "jp", countryName: "Japan", city: "Tokyo", serverName: "JP#1" } });
    expect(response.statusCode).toBe(400);
  });

  it("server ID は serverName から導出した値と一致しなければならない", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/connection/locations/srv-us-il-1/favorite", payload: { id: "srv-us-il-1", kind: "server", country: "us", countryName: "United States", city: "Chicago", serverName: "US-IL#2" } });
    expect(response.statusCode).toBe(400);
  });
});
