// 責務: 操作の実行可否（未ログイン・プラン制限・失敗からの学習）と、プランの情報（補足情報・参考一覧）の受け入れテスト。
// 受け入れ条件 apiserver/AC-6・AC-7・AC-20〜AC-22 を、CLIの代役の出力を切り替えて確認する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCli } from "../helpers/fake-cli.js";
import { startApiHarness, type ApiHarness } from "../helpers/api-harness.js";

const cli = createFakeCli();
// 無料プランで接続できるサーバ一覧のキャッシュ（CLIが保存するファイルの代役）。
const cacheDir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-cache-"));
mkdirSync(join(cacheDir, "protonvpn", "VPN"), { recursive: true });
writeFileSync(
  join(cacheDir, "protonvpn", "VPN", "serverlist.json"),
  JSON.stringify({
    LogicalServers: [
      { Name: "JP-FREE#1", Domain: "node-jp-1.example.invalid", ExitCountry: "JP", City: "Tokyo", Tier: 0, Status: 1 },
      { Name: "JP-FREE#2", Domain: "node-jp-2.example.invalid", ExitCountry: "JP", City: "Osaka", Tier: 0, Status: 1 },
      { Name: "US-FREE#1", Domain: "node-us-1.example.invalid", ExitCountry: "US", City: "Seattle", Tier: 0, Status: 1 },
      { Name: "DE#1", Domain: "node-de-1.example.invalid", ExitCountry: "DE", City: "Berlin", Tier: 2, Status: 1 },
    ],
  }),
);
let harness: ApiHarness;

beforeAll(async () => {
  harness = await startApiHarness({ handlers: { exec: cli.exec }, providerCacheDir: cacheDir });
});
afterAll(async () => {
  await harness.stop();
});

const get = (url: string) => harness.app.inject({ method: "GET", url });
const capabilities = async () =>
  ((await get("/v1/connection/capabilities")).json() as { capabilities: Record<string, { available: boolean; reason?: string; message?: string }> }).capabilities;

/**
 * 目的: 選択中のベンダーの判定のキャッシュを破棄する（ログアウトの成功は、ログイン状態とプランの判定と、学習した制限を破棄する）。
 * 入力: loggedIn(破棄の後に、CLIの代役へ設定するログイン状態)。
 */
async function resetJudgement(loggedIn: boolean): Promise<void> {
  await harness.app.inject({ method: "DELETE", url: "/v1/session" });
  cli.state.loggedIn = loggedIn;
}
async function switchTo(providerId: string): Promise<void> {
  await harness.app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId } });
}

describe("操作の実行可否", () => {
  it("apiserver/AC-6: 未ログインの間は接続先を使う操作が未ログインの理由で不可となり、ログイン後は可となる", async () => {
    await resetJudgement(false);
    const before = await capabilities();
    for (const operation of ["connectToLocation", "locationList", "changeLocation", "locationFavorites", "pingMeasurement"]) {
      expect(before[operation], operation).toMatchObject({ available: false, reason: "notLoggedIn" });
      expect(before[operation]?.message).toBe("ログインしてください");
    }
    // 切断とログインは、未ログインでも常に可能である。
    expect(before.disconnect?.available).toBe(true);
    expect(before.login?.available).toBe(true);
    // プロファイルにない操作は、非対応の理由で不可になる。
    expect(before.connectAuto).toMatchObject({ available: false, reason: "unsupported" });

    await resetJudgement(true);
    const after = await capabilities();
    expect(after.connectToLocation?.available).toBe(true);
    expect(after.locationList?.available).toBe(true);
  });

  it("apiserver/AC-7: プラン制限を示す失敗は403で通知され、以後その操作がプラン制限の理由で不可となる", async () => {
    await switchTo("protonvpn");
    // 有料プランとして判定される状態から、CLIが接続先の指定をプラン制限で拒否する。
    cli.state.plan = "premium";
    cli.state.restrictConnect = true;
    await resetJudgement(true);
    expect((await capabilities()).connectToLocation?.available).toBe(true);

    const restricted = await harness.app.inject({ method: "PUT", url: "/v1/connection", payload: { connect: true, locationId: "jp-japan" } });
    expect(restricted.statusCode).toBe(403);
    expect(restricted.json()).toMatchObject({ error: "operation_restricted" });

    const after = await capabilities();
    expect(after.connectToLocation).toMatchObject({ available: false, reason: "planRestricted" });
    // 接続先の一覧は接続先の指定と相互に依存するため、同じ理由で不可になる。
    expect(after.locationList).toMatchObject({ available: false, reason: "planRestricted" });
    expect(after.disconnect?.available).toBe(true);
    cli.state.restrictConnect = false;
  });

  it("apiserver/AC-22: 実行可否を続けて取得しても、判定のCLIは30秒に1回しか起動されない", async () => {
    await switchTo("adguardvpn");
    cli.state.plan = "premium";
    await resetJudgement(true);
    const before = cli.state.calls["adguardvpn:license"] ?? 0;
    await capabilities();
    await capabilities();
    await get("/v1/session");
    expect((cli.state.calls["adguardvpn:license"] ?? 0) - before).toBe(1);
    // 判定に失敗（不明）した場合はキャッシュせず、次の要求で再判定する。
    cli.state.failing.add("license");
    await resetJudgement(true);
    const unknownBefore = cli.state.calls["adguardvpn:license"] ?? 0;
    await capabilities();
    await capabilities();
    expect((cli.state.calls["adguardvpn:license"] ?? 0) - unknownBefore).toBe(2);
    cli.state.failing.clear();
  });
});

describe("プランの情報", () => {
  it("apiserver/AC-20: プランの補足情報が、ログイン状態の応答のプランに含まれる", async () => {
    await switchTo("adguardvpn");
    cli.state.plan = "free";
    await resetJudgement(true);
    const session = (await get("/v1/session")).json();
    expect(session).toEqual({
      loginMethod: "deviceUrl",
      loggedIn: true,
      plan: { id: "free", label: "Free", usageNote: "You have 3.00 GB left for this month" },
    });
    // 補足情報の宣言がないプラン（有料）では、補足情報を省く。
    cli.state.plan = "premium";
    await resetJudgement(true);
    expect(((await get("/v1/session")).json() as { plan: object }).plan).toEqual({ id: "premium", label: "Premium" });
  });

  it("apiserver/AC-21: 接続先を選べないプランでは、サーバ一覧から国と都市だけの参考一覧が返る", async () => {
    await switchTo("protonvpn");
    cli.state.plan = "free";
    await resetJudgement(true);
    const response = await get("/v1/connection/available-locations");
    expect(response.statusCode).toBe(200);
    const { locations } = response.json() as { locations: Array<{ code: string; name: string; cities: string[] }> };
    // 無料のサーバだけが対象で、国名は日本語、都市は重複を除いて昇順に並ぶ。
    expect(locations.map((location) => location.code).sort()).toEqual(["JP", "US"]);
    expect(locations.find((location) => location.code === "JP")).toEqual({ code: "JP", name: "日本", cities: ["Osaka", "Tokyo"] });
    // サーバのドメインや名前は、応答に含まれない。
    expect(response.body).not.toContain("example.invalid");
    expect(response.body).not.toContain("FREE#");
    // 接続先を選べるベンダーでは、空の一覧を返す。
    await switchTo("adguardvpn");
    expect((await get("/v1/connection/available-locations")).json()).toEqual({ locations: [] });
  });
});
