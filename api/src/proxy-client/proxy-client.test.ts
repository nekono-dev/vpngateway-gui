// 責務: executeVendorCommandのランタイムスキーマ検証（プロキシからのレスポンス形状チェック）の単体テスト。
// Poolはコンストラクタ内で(UDSソケットへの実接続を伴わない)独自実装に差し替え、
// レスポンスボディの検証ロジックのみを検証する。

import { describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("undici", () => ({
  Pool: class {
    request = requestMock;
  },
}));

const { executeVendorCommand } = await import("./proxy-client.js");

function jsonResponse(body: unknown) {
  return { body: { json: async () => body } };
}

describe("executeVendorCommand", () => {
  it("プロキシが期待通りの形状で応答した場合はそのまま返す", async () => {
    requestMock.mockResolvedValue(jsonResponse({ exitCode: 0, stdout: "connected", stderr: "" }));

    const result = await executeVendorCommand({
      vendor: "adguardvpn",
      binary: "/usr/local/bin/adguardvpn-cli",
      resolvedArgv: ["status"],
      timeoutMs: 8000,
    });

    expect(result).toEqual({ exitCode: 0, stdout: "connected", stderr: "" });
  });

  it("プロキシが期待と異なる形状で応答した場合は例外を投げる", async () => {
    requestMock.mockResolvedValue(jsonResponse({ exitCode: "0", stdout: "connected" }));

    await expect(
      executeVendorCommand({
        vendor: "adguardvpn",
        binary: "/usr/local/bin/adguardvpn-cli",
        resolvedArgv: ["status"],
        timeoutMs: 8000,
      }),
    ).rejects.toThrow(/unexpected response shape from proxy/);
  });
});
