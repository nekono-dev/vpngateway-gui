// 責務: 起動時の接続状態の復元（restoreConnectionOnStartup、Phase 16）の単体テスト。
// ランナーとの通信（proxy-client）をモックし、「直前に接続中だった接続先」の保存内容から
// 実際に再接続コマンドが発行されるか・されないかを検証する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-restore-test-"));
process.env.VENDORS_DIR = join(import.meta.dirname, "../../../e2e/vendors");
process.env.ENABLED_PROVIDERS = "mockproton";
process.env.STATE_DIR = dir;
process.env.PROVIDER_CACHE_DIR = join(dir, "cache");
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");

const { executeVendorCommandMock, checkRunnerHealthMock } = vi.hoisted(() => ({
  executeVendorCommandMock: vi.fn(),
  checkRunnerHealthMock: vi.fn(),
}));
vi.mock("../proxy-client/proxy-client.js", () => ({
  executeVendorCommand: (providerId: string, input: unknown) => executeVendorCommandMock(input, providerId),
  requestConnectionCheck: async () => true,
  checkRunnerHealth: (providerId: string) => checkRunnerHealthMock(providerId),
}));

const { restoreConnectionOnStartup } = await import("./restore-connection.js");
const { saveConnectedLocation, clearConnectedLocation } = await import("./connection-state-store.js");

const P = "mockproton";
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
const COUNTRIES = "Country          Code\n---------------  ------\nJapan            JP\n";

/** 発行されたコマンドのうち、指定したサブコマンドのものだけを返す。 */
function calls(command: string): { resolvedArgv: string[] }[] {
  return executeVendorCommandMock.mock.calls
    .map((args: unknown[]) => args[0] as { resolvedArgv: string[] })
    .filter((input) => input.resolvedArgv[0] === command);
}

const logger = { info: vi.fn(), warn: vi.fn() };

describe("起動時の接続状態の復元", () => {
  beforeEach(() => {
    clearConnectedLocation(P);
    executeVendorCommandMock.mockReset();
    checkRunnerHealthMock.mockReset();
    checkRunnerHealthMock.mockResolvedValue(true);
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  it("保存済みの接続先が無ければ何もしない（一度も接続していない・直前が切断中だった）", async () => {
    await restoreConnectionOnStartup(logger);
    expect(executeVendorCommandMock).not.toHaveBeenCalled();
  });

  it("直前に接続先を指定して接続していた場合、切断状態から観測されたら同じ接続先へ再接続する", async () => {
    saveConnectedLocation(P, { locationId: "jp-japan", country: "jp" }, "JP");
    executeVendorCommandMock.mockImplementation(({ resolvedArgv }: { resolvedArgv: string[] }) => {
      const [command] = resolvedArgv;
      if (command === "status") return Promise.resolve(ok("Status: Disconnected"));
      if (command === "countries") return Promise.resolve(ok(COUNTRIES));
      if (command === "connect") return Promise.resolve(ok("Connected to JP. \nYour new IP address is 1.2.3.4."));
      return Promise.resolve(ok(""));
    });
    await restoreConnectionOnStartup(logger);
    const connectCalls = calls("connect");
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].resolvedArgv).toEqual(["connect", "--country", "JP"]);
  });

  it("直前が自動接続（接続先の指定なし）だった場合、切断状態から観測されたら接続先を指定せず再接続する", async () => {
    saveConnectedLocation(P, {}, "JP-FREE#5 in Tokyo, Japan");
    executeVendorCommandMock.mockImplementation(({ resolvedArgv }: { resolvedArgv: string[] }) => {
      const [command] = resolvedArgv;
      if (command === "status") return Promise.resolve(ok("Status: Disconnected"));
      if (command === "connect") return Promise.resolve(ok("Connected to JP-FREE#5 in Tokyo, Japan."));
      return Promise.resolve(ok(""));
    });
    await restoreConnectionOnStartup(logger);
    const connectCalls = calls("connect");
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].resolvedArgv).toEqual(["connect"]);
  });

  it("既に接続中（プロセス単体の再起動等でトンネルが生きていた）なら再接続しない", async () => {
    saveConnectedLocation(P, { locationId: "jp-japan", country: "jp" }, "JP");
    executeVendorCommandMock.mockImplementation(({ resolvedArgv }: { resolvedArgv: string[] }) => {
      const [command] = resolvedArgv;
      if (command === "status") return Promise.resolve(ok("Status: Connected\nServer: JP"));
      return Promise.resolve(ok(""));
    });
    await restoreConnectionOnStartup(logger);
    expect(calls("connect")).toHaveLength(0);
  });

  it("ランナーが起動していなければ再接続を試みず、警告を記録する", async () => {
    saveConnectedLocation(P, { locationId: "jp-japan", country: "jp" }, "JP");
    checkRunnerHealthMock.mockResolvedValue(false);
    await restoreConnectionOnStartup(logger);
    expect(executeVendorCommandMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  }, 15000);
});
