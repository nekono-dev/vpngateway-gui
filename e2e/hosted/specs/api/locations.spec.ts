// 責務: 接続先・お気に入り・ベンダー切り替えの試験（stack 群・api）。要件 4.1〜4.10。
// 切断の失敗と応答の遅延は、モック CLI の制御（disconnectFails・responseDelayMs）で起こす。
// 直列に実行する（ベンダーの選択と接続の状態を、前の試験から引き継ぐ）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { apiClient, runnerContainer, setMockControl } from "../../fixtures/stack";
import { connectVpn, disconnectVpn, ensureAdminLogin, firstLocationId, loginVpn } from "../../fixtures/gateway";
import type { ApiClient } from "../../../common/api-client";

const run = promisify(execFile);

type Provider = { id: string; displayName: string; active: boolean; available: boolean };
type Location = { id: string; favorite: boolean };

/** 目的: 選択中のベンダーの ID を得る。 */
async function activeProviderId(client: ApiClient): Promise<string | undefined> {
  const res = await client.get<Provider[]>("/v1/providers");
  expect(res.ok, "ベンダーの一覧が得られない").toBe(true);
  return res.ok ? res.body.find((provider) => provider.active)?.id : undefined;
}

/** 目的: ベンダーのランナーが応答するまで待つ（上限 60 秒）。 */
async function waitForProviderAvailable(client: ApiClient, id: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await client.get<Provider[]>("/v1/providers");
    if (res.ok && res.body.find((provider) => provider.id === id)?.available) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`ベンダー ${id} のランナーが応答しなかった（上限 60 秒）`);
}

/** 目的: ベンダーへ切り替え、結果の HTTP の状態コードを返す（成功は 200）。 */
async function switchTo(client: ApiClient, providerId: string): Promise<number> {
  const res = await client.put("/v1/providers/active", { providerId });
  return res.ok ? res.status : res.kind === "http" ? res.status : 0;
}

test.describe.serial("接続先・お気に入り・ベンダー切り替え（stack・api）", () => {
  test.describe.configure({ timeout: 10 * 60 * 1000 });
  const client = apiClient();

  test.beforeAll(async () => {
    test.setTimeout(5 * 60 * 1000);
    await ensureAdminLogin(client);
    await loginVpn(client);
    await setMockControl("protonvpn", {});
    await setMockControl("adguardvpn", {});
    const put = await client.put("/v1/providers/active", { providerId: "protonvpn" });
    expect(put.ok, "プロバイダの切り替えに失敗").toBe(true);
  });

  test.afterAll(async () => {
    // 後始末: 制御を解除し、ランナーを起動状態にする。ベンダーは protonvpn へ戻す
    await setMockControl("protonvpn", {}).catch(() => undefined);
    await setMockControl("adguardvpn", {}).catch(() => undefined);
    await run("sudo", ["docker", "start", runnerContainer("adguardvpn")]).catch(() => undefined);
    await client.put("/v1/providers/active", { providerId: "protonvpn" }).catch(() => undefined);
  });

  test("4.1: 接続先の一覧が得られる", async () => {
    const res = await client.get<Location[]>("/v1/connection/locations");
    expect(res.ok, "接続先の一覧が得られない").toBe(true);
    expect(res.ok && res.body.length, "接続先が 1 件も無い").toBeGreaterThan(0);
  });

  test("4.2・4.3: お気に入りの登録と解除が、一覧に反映される", async () => {
    const id = await firstLocationId(client);
    const add = await client.put<{ favorite: boolean }>(`/v1/connection/locations/${id}/favorite`, undefined);
    expect(add.ok && add.body.favorite).toBe(true);
    const listed = await client.get<Location[]>("/v1/connection/locations");
    expect(listed.ok && listed.body.find((location) => location.id === id)?.favorite).toBe(true);

    const remove = await client.delete<{ favorite: boolean }>(`/v1/connection/locations/${id}/favorite`);
    expect(remove.ok && remove.body.favorite).toBe(false);
    const after = await client.get<Location[]>("/v1/connection/locations");
    expect(after.ok && after.body.find((location) => location.id === id)?.favorite).toBe(false);
  });

  test("4.4: ベンダーを切り替えると、切り替え後のベンダーが有効になる", async () => {
    expect(await switchTo(client, "adguardvpn")).toBe(200);
    expect(await activeProviderId(client)).toBe("adguardvpn");
    expect(await switchTo(client, "protonvpn")).toBe(200);
    expect(await activeProviderId(client)).toBe("protonvpn");
  });

  test("4.5: 接続中に切り替えると、切り替え前のベンダーを切断してから切り替える", async () => {
    await connectVpn(client);
    expect(await switchTo(client, "adguardvpn")).toBe(200);
    expect(await activeProviderId(client)).toBe("adguardvpn");
    // 切り替え前のベンダー（protonvpn）は切断されている
    await switchTo(client, "protonvpn");
    const state = await client.get<{ status: string }>("/v1/connection");
    expect(state.ok && state.body.status).toBe("disconnected");
  });

  test("4.6: 選択中と同じ ID の指定は、成功として扱う", async () => {
    expect(await switchTo(client, "protonvpn")).toBe(200);
    expect(await activeProviderId(client)).toBe("protonvpn");
  });

  test("4.7: 未登録の ID は 400 で拒否する", async () => {
    expect(await switchTo(client, "unknownvendor")).toBe(400);
    expect(await activeProviderId(client)).toBe("protonvpn");
  });

  test("4.8: 切り替え先のランナーが停止していると 502 を返し、有効なベンダーは変わらない", async () => {
    await run("sudo", ["docker", "stop", runnerContainer("adguardvpn")]);
    try {
      expect(await switchTo(client, "adguardvpn")).toBe(502);
      expect(await activeProviderId(client)).toBe("protonvpn");
    } finally {
      await run("sudo", ["docker", "start", runnerContainer("adguardvpn")]);
      await waitForProviderAvailable(client, "adguardvpn");
    }
  });

  test("4.9: 現在のベンダーの切断が失敗すると 422 を返し、有効なベンダーは変わらない", async () => {
    await connectVpn(client);
    await setMockControl("protonvpn", { disconnectFails: true });
    try {
      expect(await switchTo(client, "adguardvpn")).toBe(422);
      expect(await activeProviderId(client)).toBe("protonvpn");
    } finally {
      await setMockControl("protonvpn", {});
    }
    await disconnectVpn(client);
  });

  test("4.10: 切り替えの途中で重ねて要求すると 409 を返す", async () => {
    await connectVpn(client);
    // 切断の確認に時間がかかるよう、応答を遅らせる（切り替えの途中の状態を作る）
    await setMockControl("protonvpn", { responseDelayMs: 3000 });
    try {
      const first = switchTo(client, "adguardvpn");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await switchTo(client, "adguardvpn")).toBe(409);
      expect(await first).toBe(200);
    } finally {
      await setMockControl("protonvpn", {});
    }
    expect(await activeProviderId(client)).toBe("adguardvpn");
    expect(await switchTo(client, "protonvpn")).toBe(200);
  });
});
