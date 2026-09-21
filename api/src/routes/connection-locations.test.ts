// 責務: GET /v1/connection/locations と、お気に入り登録・解除の統合テスト（プロキシ通信はモック）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ProxyUnavailableError } from "../errors.js";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
process.env.STATE_DIR = dir;
/** AdGuard VPNのベンダー別状態ファイルのパス。 */
const statePath = (name: string) => join(dir, "providers", "adguardvpn", name);

const { executeVendorCommandMock } = vi.hoisted(() => ({ executeVendorCommandMock: vi.fn() }));
// 第1引数を入力、第2引数をベンダーIDとして記録する（呼び出し内容の検証を、入力を先頭にして書けるようにするため）。
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => executeVendorCommandMock(input, providerId),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: async () => true,
}));

const { buildApp } = await import("../app.js");
const { saveLastLocationId } = await import("../locations/last-location-store.js");

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

  it("ping昇順で、favorite・lastConnectedを付けて返し、接続時の指定名は含めない", async () => {
    saveLastLocationId("adguardvpn", "jp-tokyo");
    await app.inject({ method: "PUT", url: "/v1/connection/locations/cn-shanghai-virtual/favorite" });

    const response = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo", pingMs: 4, favorite: false, lastConnected: true },
      { id: "cn-shanghai-virtual", country: "cn", countryName: "China", city: "Shanghai (Virtual)", pingMs: 59, favorite: true, lastConnected: false },
      { id: "us-las-vegas", country: "us", countryName: "United States", city: "Las Vegas", pingMs: 111, favorite: false, lastConnected: false },
    ]);
  });

  it("list-locationsを実行するのは、リクエストごと（キャッシュしない）", async () => {
    await app.inject({ method: "GET", url: "/v1/connection/locations" });
    await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(2);
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
    const add = await app.inject({ method: "PUT", url: "/v1/connection/locations/us-las-vegas/favorite" });
    expect(add.json()).toEqual({ locationId: "us-las-vegas", favorite: true });
    await app.inject({ method: "PUT", url: "/v1/connection/locations/us-las-vegas/favorite" });

    const listed = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(listed.json().filter((l: { favorite: boolean }) => l.favorite).map((l: { id: string }) => l.id)).toEqual(["us-las-vegas"]);

    const removed = await app.inject({ method: "DELETE", url: "/v1/connection/locations/us-las-vegas/favorite" });
    expect(removed.json()).toEqual({ locationId: "us-las-vegas", favorite: false });
    await app.inject({ method: "DELETE", url: "/v1/connection/locations/us-las-vegas/favorite" });
    const after = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(after.json().some((l: { favorite: boolean }) => l.favorite)).toBe(false);
  });

  it("形式不正な接続先IDのお気に入り操作は400", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/connection/locations/Tokyo/favorite" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_input" });
  });
});
