// 責務: プロファイルが対応しない操作（アクション未定義）が501（operation_unsupported）で拒否され、
// CLIを実行しないことの統合テスト。logout・listLocations・login を欠くプロファイルを一時ファイルで用意する。

import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
const base = JSON.parse(readFileSync(join(import.meta.dirname, "../../../e2e/vendors/mockproton/profile.json"), "utf8"));
delete base.actions.logout;
delete base.actions.listLocations;
delete base.actions.login;
delete base.actions.account;
mkdirSync(join(dir, "mockproton"));
writeFileSync(join(dir, "mockproton", "profile.json"), JSON.stringify(base));
process.env.VENDORS_DIR = dir;
process.env.ENABLED_PROVIDERS = "mockproton";
process.env.STATE_DIR = dir;
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");

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

describe("プロバイダ非対応の操作（501）", () => {
  const app = buildApp();

  it("logout未定義: DELETE /v1/session は501で、CLIを実行しない", async () => {
    const response = await app.inject({ method: "DELETE", url: "/v1/session" });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({ error: "operation_unsupported" });
    expect(executeVendorCommandMock).not.toHaveBeenCalled();
  });

  it("login未定義: POST /v1/session は501", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/session", payload: { username: "u", password: "p" } });
    expect(response.statusCode).toBe(501);
    expect(executeVendorCommandMock).not.toHaveBeenCalled();
  });

  it("listLocations未定義: GET /v1/connection/locations は501", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(response.statusCode).toBe(501);
    expect(executeVendorCommandMock).not.toHaveBeenCalled();
  });

  it("listLocations未定義: 接続先を指定した接続は501（接続先を解決できない）", async () => {
    const response = await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true, locationId: "jp-japan" } });
    expect(response.statusCode).toBe(501);
    expect(executeVendorCommandMock).not.toHaveBeenCalled();
  });

  it("接続先を指定しない接続（connectAuto）は実行できる", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 0, stdout: "Connected to JP-FREE#5 in Tokyo, Japan.", stderr: "" });
    const response = await app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "connected", location: "JP-FREE#5 in Tokyo, Japan" });
  });
});
