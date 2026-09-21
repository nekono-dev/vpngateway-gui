// 責務: executeVendorCommandのランタイムスキーマ検証（プロキシからのレスポンス形状チェック）の単体テスト。
// Poolはコンストラクタ内で(UDSソケットへの実接続を伴わない)独自実装に差し替え、
// レスポンスボディの検証ロジックのみを検証する。

import { describe, expect, it, vi } from "vitest";

const { requestMock, sockets } = vi.hoisted(() => ({ requestMock: vi.fn(), sockets: [] as string[] }));

vi.mock("undici", () => ({
  Pool: class {
    request = requestMock;
    constructor(_origin: string, options: { socketPath: string }) {
      sockets.push(options.socketPath);
    }
  },
}));

const { executeVendorCommand, notifySettings, fetchProxyStatus, checkRunnerHealth, requestConnectionCheck } =
  await import("./proxy-client.js");

function jsonResponse(body: unknown) {
  return { body: { json: async () => body } };
}

describe("executeVendorCommand", () => {
  it("プロキシが期待通りの形状で応答した場合はそのまま返す", async () => {
    requestMock.mockResolvedValue(jsonResponse({ exitCode: 0, stdout: "connected", stderr: "" }));

    const result = await executeVendorCommand("adguardvpn", {
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
      executeVendorCommand("adguardvpn", {
        vendor: "adguardvpn",
        binary: "/usr/local/bin/adguardvpn-cli",
        resolvedArgv: ["status"],
        timeoutMs: 8000,
      }),
    ).rejects.toThrow(/unexpected response shape from proxy/);
  });
});

describe("notifySettings", () => {
  it("プロキシが期待通りの形状で応答した場合はそのまま返す", async () => {
    requestMock.mockResolvedValue(jsonResponse({ applied: true }));

    const result = await notifySettings({ killSwitch: true, transparentGatewayEnabled: true });

    expect(result).toEqual({ applied: true });
  });

  it("プロキシが期待と異なる形状で応答した場合は例外を投げる", async () => {
    requestMock.mockResolvedValue(jsonResponse({ applied: "yes" }));

    await expect(notifySettings({ killSwitch: true, transparentGatewayEnabled: true })).rejects.toThrow(
      /unexpected response shape from proxy/,
    );
  });
});

describe("fetchProxyStatus", () => {
  it("プロキシが期待通りの形状で応答した場合はそのまま返し、GET /statusを呼ぶ", async () => {
    const status = {
      transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
      explicitProxy: { state: "active", socksPort: 1080, httpPort: 3128, restartCount: 0 },
    };
    requestMock.mockResolvedValue(jsonResponse(status));

    const result = await fetchProxyStatus();

    expect(result).toEqual(status);
    expect(requestMock).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/status", method: "GET" }));
  });

  it("vpnInterface省略（未接続）でも受理する", async () => {
    const status = {
      transparentGateway: { state: "stopped", killSwitchBlocking: false },
      explicitProxy: { state: "stopped", restartCount: 0 },
    };
    requestMock.mockResolvedValue(jsonResponse(status));
    await expect(fetchProxyStatus()).resolves.toEqual(status);
  });

  it("明示的プロキシのcrashLoop状態も受理する", async () => {
    const status = {
      transparentGateway: { state: "stopped", killSwitchBlocking: false },
      explicitProxy: { state: "crashLoop", restartCount: 5 },
    };
    requestMock.mockResolvedValue(jsonResponse(status));
    await expect(fetchProxyStatus()).resolves.toEqual(status);
  });

  it("explicitProxyを含まない応答（旧バージョンのproxy）は形状不一致として例外を投げる", async () => {
    requestMock.mockResolvedValue(
      jsonResponse({ transparentGateway: { state: "stopped", killSwitchBlocking: false } }),
    );
    await expect(fetchProxyStatus()).rejects.toThrow(/unexpected response shape from proxy/);
  });

  it("プロキシが期待と異なる形状で応答した場合は例外を投げる", async () => {
    requestMock.mockResolvedValue(jsonResponse({ transparentGateway: { state: "weird" } }));
    await expect(fetchProxyStatus()).rejects.toThrow(/unexpected response shape from proxy/);
  });

  it("ソケット未起動はProxyUnavailableError、タイムアウトはProxyTimeoutErrorへ変換する", async () => {
    requestMock.mockRejectedValue(Object.assign(new Error("x"), { code: "ENOENT" }));
    await expect(fetchProxyStatus()).rejects.toThrow(/failed to connect/);
    requestMock.mockRejectedValue(Object.assign(new Error("x"), { code: "UND_ERR_HEADERS_TIMEOUT" }));
    await expect(fetchProxyStatus()).rejects.toThrow(/did not respond/);
  });
});

describe("宛先のUDS（Phase 11: ランナーはベンダー別、ネットワークコンテナはnet.sock）", () => {
  it("ネットワークコンテナ宛はnet.sock、ランナー宛はrunner-<ベンダーID>.sockに接続する", async () => {
    requestMock.mockResolvedValue(jsonResponse({ exitCode: 0, stdout: "", stderr: "" }));
    await executeVendorCommand("protonvpn", { vendor: "protonvpn", binary: "/usr/bin/protonvpn", resolvedArgv: ["status"], timeoutMs: 1000 });
    await executeVendorCommand("adguardvpn", { vendor: "adguardvpn", binary: "/x", resolvedArgv: ["status"], timeoutMs: 1000 });
    expect(sockets).toContain("/var/run/vpngw-ctl/net.sock");
    expect(sockets).toContain("/var/run/vpngw-ctl/runner-protonvpn.sock");
    expect(sockets).toContain("/var/run/vpngw-ctl/runner-adguardvpn.sock");
  });
});

describe("checkRunnerHealth", () => {
  it("200で応答すれば利用可能", async () => {
    requestMock.mockResolvedValue({ statusCode: 200, body: { dump: async () => undefined } });
    expect(await checkRunnerHealth("protonvpn")).toBe(true);
  });

  it("接続失敗・タイムアウト・200以外は利用不可（例外にしない）", async () => {
    requestMock.mockRejectedValue(Object.assign(new Error("connect ENOENT"), { code: "ENOENT" }));
    expect(await checkRunnerHealth("protonvpn")).toBe(false);
    requestMock.mockResolvedValue({ statusCode: 500, body: { dump: async () => undefined } });
    expect(await checkRunnerHealth("protonvpn")).toBe(false);
  });
});

describe("requestConnectionCheck", () => {
  it("checked=trueで応答すればtrue", async () => {
    requestMock.mockResolvedValue(jsonResponse({ checked: true }));
    expect(await requestConnectionCheck()).toBe(true);
    expect(requestMock).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/connection-checks", method: "POST" }));
  });

  it("失敗しても例外にせずfalse（ルールの反映は接続監視ループが追従する）", async () => {
    requestMock.mockRejectedValue(new Error("down"));
    expect(await requestConnectionCheck()).toBe(false);
    requestMock.mockResolvedValue(jsonResponse({ checked: false }));
    expect(await requestConnectionCheck()).toBe(false);
  });
});
