// 責務: プランで接続できる接続先の参考一覧（国の行）が、利用者の国の首都からの距離順で返ることの統合テスト（キャッシュとプランは差し替え）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-plan-distance-"));
const cacheDir = join(dir, "cache");
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "protonvpn";
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
process.env.STATE_DIR = dir;
process.env.PROVIDER_CACHE_DIR = cacheDir;

// 無料プランと判定する（参考一覧の出典を持つプラン）。
vi.mock("../session/session-probe.js", () => ({
  getSessionInfo: async () => ({ plan: { id: "free", label: "Free" } }),
}));

const { buildApp: buildRawApp } = await import("../app.js");
const { withAuthenticatedInject } = await import("../auth/test-support.js");
function buildApp() {
  return withAuthenticatedInject(buildRawApp());
}

beforeEach(() => {
  mkdirSync(join(cacheDir, "protonvpn", "VPN"), { recursive: true });
  writeFileSync(
    join(cacheDir, "protonvpn", "VPN", "serverlist.json"),
    JSON.stringify({
      LogicalServers: [
        { ExitCountry: "US", City: "Chicago", Tier: 0, Status: 1 },
        { ExitCountry: "UK", City: "London", Tier: 0, Status: 1 },
        { ExitCountry: "JP", City: "Tokyo", Tier: 0, Status: 1 },
      ],
    }),
  );
  writeFileSync(join(dir, "user-location.json"), "{}");
});

describe("GET /v1/connection/available-locations（距離の注釈）", () => {
  it("ja-JP を既定の基点として、国の行を距離順に並べ、距離を付ける（UK は GB として扱う）", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: "/v1/connection/available-locations",
      headers: { "accept-language": "ja-JP" },
    });
    expect(response.statusCode).toBe(200);
    const locations = response.json().locations as Array<{ code: string; distanceKm?: number }>;
    expect(locations.map((l) => l.code)).toEqual(["JP", "UK", "US"]);
    expect(locations[0].distanceKm).toBe(0);
    expect(locations[1].distanceKm).toBeGreaterThan(9000);
  });

  it("利用者の場所が決まらなければ、距離は付けず、既存の順序（名称順）のまま", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: "/v1/connection/available-locations",
      headers: { "accept-language": "en" },
    });
    const locations = response.json().locations as Array<{ code: string; distanceKm?: number }>;
    expect(locations.every((l) => l.distanceKm === undefined)).toBe(true);
  });
});
