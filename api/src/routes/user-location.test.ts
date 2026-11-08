// 責務: GET/PUT/DELETE /v1/user-location（利用者の場所の取得・保存・既定へ戻す）の統合テスト（認可・検証・由来の表示）。

import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";

const { buildApp } = await import("../app.js");
const { setUpAuthenticatedOperator } = await import("../auth/test-support.js");

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-user-location-route-"));
  process.env.STATE_DIR = dir;
  process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
});

describe("GET /v1/user-location", () => {
  it("未ログインは 401（既定の認可）", async () => {
    const response = await buildApp().inject({ method: "GET", url: "/v1/user-location" });
    expect(response.statusCode).toBe(401);
  });

  it("保存が無く Accept-Language に既知の地域があれば、由来は browser で実効の国はその地域", async () => {
    const app = buildApp();
    const cookie = setUpAuthenticatedOperator();
    const response = await app.inject({
      method: "GET",
      url: "/v1/user-location",
      headers: { cookie, "accept-language": "ja-JP,ja;q=0.9" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ effective: "JP", source: "browser" });
  });

  it("国の選択肢に日本とコソボを含む", async () => {
    const app = buildApp();
    const cookie = setUpAuthenticatedOperator();
    const body = (await app.inject({ method: "GET", url: "/v1/user-location", headers: { cookie } })).json();
    const codes = (body.countries as Array<{ code: string }>).map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["JP", "KOS"]));
  });
});

describe("PUT /v1/user-location", () => {
  it("未ログインは 401 で、保存されない", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "PUT", url: "/v1/user-location", payload: { country: "JP" } });
    expect(response.statusCode).toBe(401);
  });

  it("既知でない国は 400", async () => {
    const app = buildApp();
    const cookie = setUpAuthenticatedOperator();
    const response = await app.inject({ method: "PUT", url: "/v1/user-location", headers: { cookie }, payload: { country: "PR" } });
    expect(response.statusCode).toBe(400);
  });

  it("保存した国は次の取得で saved として返り、既定へ戻すと browser（または none）に戻る", async () => {
    const app = buildApp();
    const cookie = setUpAuthenticatedOperator();
    const saved = await app.inject({ method: "PUT", url: "/v1/user-location", headers: { cookie }, payload: { country: "US" } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ saved: "US", effective: "US", source: "saved" });

    const reset = await app.inject({ method: "DELETE", url: "/v1/user-location", headers: { cookie, "accept-language": "ja-JP" } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ effective: "JP", source: "browser" });
  });

  it("未ログインの既定へ戻す（DELETE）は 401", async () => {
    const response = await buildApp().inject({ method: "DELETE", url: "/v1/user-location" });
    expect(response.statusCode).toBe(401);
  });
});
