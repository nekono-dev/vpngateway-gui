// 責務: ベンダーの一覧・切替・利用可否の確認の受け入れテスト。
// 受け入れ条件 apiserver/AC-4・AC-5・AC-23 を、相互TLSのゲートウェイの代役とCLIの代役を使って確認する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeCli } from "../helpers/fake-cli.js";
import { startApiHarness, type ApiHarness } from "../helpers/api-harness.js";

const cli = createFakeCli();
// ランナーの利用可否。ベンダーIDごとに、応答する・応答しない・遅れて応答するを切り替える。
const health: Record<string, boolean | number> = { adguardvpn: true, protonvpn: true };
let harness: ApiHarness;

beforeAll(async () => {
  harness = await startApiHarness({ handlers: { exec: cli.exec, health: (vendor) => health[vendor] ?? true } });
});
afterAll(async () => {
  await harness.stop();
});
beforeEach(async () => {
  health.adguardvpn = true;
  health.protonvpn = true;
  cli.state.failing.clear();
  cli.state.connected = undefined;
  cli.state.loggedIn = true;
  cli.state.executed.length = 0;
  await harness.app.inject({ method: "PUT", url: "/v1/providers/active", payload: { providerId: "adguardvpn" } });
});

const put = (url: string, payload?: object) => harness.app.inject({ method: "PUT", url, payload });
const get = (url: string) => harness.app.inject({ method: "GET", url });
const providers = async () => (await get("/v1/providers")).json() as Array<{ id: string; active: boolean; available: boolean }>;

describe("ベンダーの選択", () => {
  it("apiserver/AC-4: 有効なベンダーの一覧に選択中が示され、切り替えてもベンダーごとのお気に入りが保たれる", async () => {
    expect((await providers()).map((provider) => [provider.id, provider.active])).toEqual([
      ["adguardvpn", true],
      ["protonvpn", false],
    ]);
    // 既定は有効なベンダーの先頭。それぞれのベンダーに、別のお気に入りを登録する。
    await put("/v1/connection/locations/jp-tokyo/favorite");
    expect((await put("/v1/providers/active", { providerId: "protonvpn" })).statusCode).toBe(200);
    expect((await providers()).find((provider) => provider.active)?.id).toBe("protonvpn");
    await put("/v1/connection/locations/us-united-states/favorite");
    const protonFavorites = ((await get("/v1/connection/locations")).json() as Array<{ id: string; favorite: boolean }>).filter((l) => l.favorite).map((l) => l.id);
    expect(protonFavorites).toEqual(["us-united-states"]);
    // 元のベンダーへ戻しても、そのベンダーのお気に入りは失われていない。
    await put("/v1/providers/active", { providerId: "adguardvpn" });
    const adguardFavorites = ((await get("/v1/connection/locations")).json() as Array<{ id: string; favorite: boolean }>).filter((l) => l.favorite).map((l) => l.id);
    expect(adguardFavorites).toEqual(["jp-tokyo"]);
    // 無効なIDは400で、選択は変わらない。
    expect((await put("/v1/providers/active", { providerId: "unknown" })).statusCode).toBe(400);
    expect((await providers()).find((provider) => provider.active)?.id).toBe("adguardvpn");
  });

  it("apiserver/AC-5: 切替時は接続中なら先に切断し、切断に失敗すると切り替えず、利用不可のランナーへは切り替えない", async () => {
    // 接続中の切替は、現在のベンダーを切断してから切り替える。
    await put("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    expect(cli.state.connected).toBe("TOKYO");
    expect((await put("/v1/providers/active", { providerId: "protonvpn" })).statusCode).toBe(200);
    expect(cli.state.connected).toBeUndefined();
    expect(cli.state.calls["adguardvpn:disconnect"]).toBeGreaterThanOrEqual(1);
    await put("/v1/providers/active", { providerId: "adguardvpn" });

    // 切断に失敗したときは、切り替えない。
    await put("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    cli.state.failing.add("disconnect");
    const failed = await put("/v1/providers/active", { providerId: "protonvpn" });
    expect(failed.statusCode).toBe(422);
    expect((await providers()).find((provider) => provider.active)?.id).toBe("adguardvpn");
    cli.state.failing.clear();

    // 利用不可のランナーへは切り替えられない。
    health.protonvpn = false;
    expect((await providers()).find((provider) => provider.id === "protonvpn")?.available).toBe(false);
    expect((await put("/v1/providers/active", { providerId: "protonvpn" })).statusCode).toBe(502);
    expect((await providers()).find((provider) => provider.active)?.id).toBe("adguardvpn");
  });

  it("apiserver/AC-23: 応答の遅いランナーがあっても、ベンダーの一覧は2秒台で返り、そのベンダーは利用不可と示される", async () => {
    health.protonvpn = 5000;
    const started = Date.now();
    const list = await providers();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(3500);
    expect(list.find((provider) => provider.id === "protonvpn")?.available).toBe(false);
    // 他のベンダーの確認は、遅いベンダーを待たない（並行して確認する）。
    expect(list.find((provider) => provider.id === "adguardvpn")?.available).toBe(true);
  });
});
