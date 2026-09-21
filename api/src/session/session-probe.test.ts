// 責務: ログイン状態・プランの判定（session-probe.ts）の単体テスト。
// 判定ロジック（純粋関数）と、キャッシュ・同時要求の集約・失敗の非キャッシュを確認する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

process.env.VPN_PROFILES_DIR = join(import.meta.dirname, "../../test-fixtures/profiles");
process.env.ENABLED_PROVIDERS = "mockproton";

const { executeVendorCommandMock } = vi.hoisted(() => ({ executeVendorCommandMock: vi.fn() }));
vi.mock("../proxy-client/proxy-client.js", () => ({ executeVendorCommand: executeVendorCommandMock }));

const { evaluateAccountOutput, getSessionInfo, invalidateSessionInfo } = await import("./session-probe.js");
const { getProviders } = await import("../providers/provider-registry.js");

const provider = getProviders()[0];
const account = provider.profile.actions.account!;

const FREE_OUTPUT = "Setting  Value\nnetshield  Upgrade to enable\nTo upgrade to VPN Plus visit: https://account.protonvpn.com/pricing";
const PAID_OUTPUT = "Setting  Value\nnetshield  off\nUse 'protonvpn config set <setting> <value>' to change settings.";

describe("evaluateAccountOutput", () => {
  it("未ログインは、終了コードが非ゼロでも未ログインと判定する", () => {
    expect(evaluateAccountOutput(account, 2, "Error: Authentication required to view feature status.")).toEqual({ loggedIn: false });
  });

  it("有料機能が有効表示の出力は、defaultPlan（有料）と判定する", () => {
    expect(evaluateAccountOutput(account, 0, PAID_OUTPUT)).toEqual({
      loggedIn: true,
      plan: { id: "paid", label: "Paid", restricts: [] },
    });
  });

  it("Upgrade to enableを含む出力は無料プランと判定し、制限と理由文を持つ", () => {
    const info = evaluateAccountOutput(account, 0, FREE_OUTPUT);
    expect(info.loggedIn).toBe(true);
    expect(info.plan).toMatchObject({ id: "free", label: "Free", restricts: ["connectToLocation", "locationList"] });
    expect(info.plan?.restrictionMessage).toContain("無料プラン");
  });

  it("未ログインでもプラン制限のパターンでもない非ゼロ終了は不明（空）", () => {
    expect(evaluateAccountOutput(account, 1, "An unexpected error occurred")).toEqual({});
    expect(evaluateAccountOutput(account, -1, "")).toEqual({});
  });
});

describe("getSessionInfo", () => {
  beforeEach(() => {
    executeVendorCommandMock.mockReset();
    invalidateSessionInfo(provider.id);
  });

  it("判定結果を30秒間キャッシュし、同じ期間の再取得ではCLIを起動しない", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 0, stdout: FREE_OUTPUT, stderr: "" });
    const first = await getSessionInfo(provider);
    const second = await getSessionInfo(provider);
    expect(first.plan?.id).toBe("free");
    expect(second).toEqual(first);
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateSessionInfoで破棄すると再判定する", async () => {
    executeVendorCommandMock.mockResolvedValueOnce({ exitCode: 0, stdout: FREE_OUTPUT, stderr: "" });
    await getSessionInfo(provider);
    invalidateSessionInfo(provider.id);
    executeVendorCommandMock.mockResolvedValueOnce({ exitCode: 0, stdout: PAID_OUTPUT, stderr: "" });
    expect((await getSessionInfo(provider)).plan?.id).toBe("paid");
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(2);
  });

  it("同時に来た要求は1回のCLI実行にまとめる", async () => {
    executeVendorCommandMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, stdout: PAID_OUTPUT, stderr: "" }), 20)),
    );
    const results = await Promise.all([getSessionInfo(provider), getSessionInfo(provider), getSessionInfo(provider)]);
    expect(executeVendorCommandMock).toHaveBeenCalledTimes(1);
    expect(results.every((info) => info.loggedIn === true)).toBe(true);
  });

  it("プロキシ未応答などで実行に失敗したら不明（空）を返し、キャッシュしない", async () => {
    executeVendorCommandMock.mockRejectedValueOnce(new Error("proxy down"));
    expect(await getSessionInfo(provider)).toEqual({});
    executeVendorCommandMock.mockResolvedValueOnce({ exitCode: 0, stdout: PAID_OUTPUT, stderr: "" });
    expect((await getSessionInfo(provider)).loggedIn).toBe(true);
  });

  it("標準エラーだけに未ログインの旨が出ても未ログインと判定する", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 2, stdout: "", stderr: "Error: Authentication required" });
    expect(await getSessionInfo(provider)).toEqual({ loggedIn: false });
  });
});
