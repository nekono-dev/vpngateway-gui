// 責務: GET/PUT /v1/ui-preferences（表示設定・テーマ）の統合テスト（公開の取得・管理者のみの保存・値の検証）。

import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";

const { buildApp } = await import("../app.js");
const { setUpAuthenticatedOperator } = await import("../auth/test-support.js");

// 保存先（STATE_DIR）はテストごとの一時ディレクトリにし、他のテストの影響を受けないようにする。
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-ui-prefs-route-"));
  process.env.STATE_DIR = dir;
  process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
});

describe("GET /v1/ui-preferences", () => {
  it("未ログインでも 200 を返し、応答は theme だけを含む（3.1・3.2・3.3）", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/ui-preferences" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ theme: "system" });
  });

  it("ログイン済みでも、応答にアカウントの情報を含めない（3.3）", async () => {
    const app = buildApp();
    const cookie = setUpAuthenticatedOperator();
    const response = await app.inject({ method: "GET", url: "/v1/ui-preferences", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json())).toEqual(["theme"]);
  });
});

describe("PUT /v1/ui-preferences", () => {
  it("未ログインの保存は 401 になり、保存された値は変わらない（7.1）", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/ui-preferences",
      payload: { theme: "dark" },
    });
    expect(response.statusCode).toBe(401);
    const after = await app.inject({ method: "GET", url: "/v1/ui-preferences" });
    expect(after.json()).toEqual({ theme: "system" });
  });

  it("ログイン済みの保存は値を保存し、次の取得（未ログイン含む）に反映される（2.1・2.2・3.1）", async () => {
    const app = buildApp();
    const cookie = setUpAuthenticatedOperator();
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/ui-preferences",
      headers: { cookie },
      payload: { theme: "dark" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ theme: "dark" });
    const loaded = await app.inject({ method: "GET", url: "/v1/ui-preferences" });
    expect(loaded.json()).toEqual({ theme: "dark" });
  });

  it("3種類以外の値は 400 になり、保存された値は変わらない（2.5）", async () => {
    const app = buildApp();
    const cookie = setUpAuthenticatedOperator();
    await app.inject({ method: "PUT", url: "/v1/ui-preferences", headers: { cookie }, payload: { theme: "light" } });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/ui-preferences",
      headers: { cookie },
      payload: { theme: "auto" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_input" });
    const loaded = await app.inject({ method: "GET", url: "/v1/ui-preferences" });
    expect(loaded.json()).toEqual({ theme: "light" });
  });
});
