// 責務: ping を計測できないプロバイダの接続先一覧が、利用者の国の首都からの距離順で返ることの統合テスト（CLI はモック）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-distance-route-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "protonvpn";
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
process.env.STATE_DIR = dir;

const { executeVendorCommandMock } = vi.hoisted(() => ({ executeVendorCommandMock: vi.fn() }));
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => executeVendorCommandMock(input, providerId),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: async () => true,
}));

const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
function buildApp() {
  return withAuthenticatedInject(buildRawApp());
}

// 国の表（列: Country・Code。固定幅）。
const countriesTable = (rows: Array<[string, string]>): string => {
  const header = "Country".padEnd(34) + "Code";
  const sep = "-".repeat(32) + "  " + "-".repeat(6);
  const body = rows.map(([name, code]) => name.padEnd(34) + code).join("\n");
  return `${header}\n${sep}\n${body}\n`;
};

const COUNTRIES = countriesTable([
  ["United States", "US"],
  ["United Kingdom", "UK"],
  ["Japan", "JP"],
  ["Puerto Rico", "PR"],
]);

beforeEach(() => {
  executeVendorCommandMock.mockReset();
  executeVendorCommandMock.mockResolvedValue({ exitCode: 0, stdout: COUNTRIES, stderr: "" });
  writeFileSync(join(dir, "user-location.json"), "{}"); // 既定（保存なし）から始める
});

type Row = { id: string; country: string; distanceKm?: number };
const countries = (rows: Row[]) => rows.map((r) => r.country);

describe("GET /v1/connection/locations（ping を計測できないプロバイダ）", () => {
  it("ブラウザの言語設定 ja-JP を既定とし、日本の首都からの距離順に並べ、距離を付ける", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: "/v1/connection/locations",
      headers: { "accept-language": "ja-JP,ja;q=0.9" },
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json() as Row[];
    expect(countries(rows)).toEqual(["jp", "uk", "us", "pr"]);
    expect(rows[0].distanceKm).toBe(0);
    expect(rows[1].distanceKm).toBeGreaterThan(9000);
    expect(rows[3].distanceKm).toBeUndefined(); // 首都が無い国は距離なし（末尾）
  });

  it("保存された利用者の場所（US）があれば、それを基点にする", async () => {
    writeFileSync(join(dir, "user-location.json"), JSON.stringify({ country: "US" }));
    const response = await buildApp().inject({
      method: "GET",
      url: "/v1/connection/locations",
      headers: { "accept-language": "ja-JP" },
    });
    expect(countries(response.json() as Row[])[0]).toBe("us");
  });

  it("利用者の場所が決まらなければ（言語に地域が無い）、CLI の順序のまま距離は付けない", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: "/v1/connection/locations",
      headers: { "accept-language": "en" },
    });
    const rows = response.json() as Row[];
    expect(countries(rows)).toEqual(["us", "uk", "jp", "pr"]);
    expect(rows.every((r) => r.distanceKm === undefined)).toBe(true);
  });
});
