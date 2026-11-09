// 責務: 国→都市→サーバの階層（場所の選択）の受け入れ試験（stack 群・api）。要件 1.1・2.3・2.4・3.1・3.7・4.7・5.1・6.1・6.2。
// ProtonVPN はモック CLI（都市一覧・サーバカタログ・サーバ名の接続）、AdGuard VPN はモック CLI（都市名の接続）で確かめる。
// 直列に実行する（ベンダーの選択と接続の状態を、前の試験から引き継ぐ）。

import { test, expect } from "@playwright/test";
import { apiClient, setMockControl } from "../../fixtures/stack";
import { ensureAdminLogin, loginVpn, waitForConnection } from "../../fixtures/gateway";
import type { ApiClient } from "../../../common/api-client";

type Country = { id: string; country: string; countryName: string; hasServerStage: boolean; favorite: boolean; lastConnected: boolean };
type City = { id: string; country: string; countryName: string; city: string; favorite: boolean; lastConnected: boolean };
type Server = { name: string; tier: string; load: number; score: number; favorite: boolean; connected: boolean };
type Favorite = { id: string; kind: string; country: string; countryName: string; city: string; serverName?: string };
type Connection = { status: string; location?: string; locationId?: string };

/** 目的: 有効なベンダーを切り替える（200 以外は試験の失敗）。 */
async function switchProvider(client: ApiClient, providerId: string): Promise<void> {
  const res = await client.put("/v1/providers/active", { providerId });
  expect(res.ok, `ベンダーの切り替えに失敗: ${providerId}`).toBe(true);
}

/** 目的: 接続を切断し、切断済みになるまで待つ（後始末の共通部品）。 */
async function ensureDisconnected(client: ApiClient): Promise<void> {
  const state = await client.get<Connection>("/v1/connection");
  if (state.ok && state.body.status === "connected") {
    await client.put("/v1/connection", { connect: false });
    await waitForConnection(client, "disconnected");
  }
}

test.describe.serial("場所の階層（国→都市→サーバ）の受け入れ（stack・api）", () => {
  test.describe.configure({ timeout: 10 * 60 * 1000 });
  const client = apiClient();

  test.beforeAll(async () => {
    test.setTimeout(5 * 60 * 1000);
    await ensureAdminLogin(client);
    await setMockControl("protonvpn", {});
    await setMockControl("adguardvpn", {});
    await loginVpn(client);
    // AdGuard VPN のログインは URL 提示型（資格情報は送らない）。モックは即座にログイン済みになる
    // URL 提示型のログインは本文を送らない（null。資格情報のスキーマは適用しない）。失敗しても、有効なベンダーは ProtonVPN へ戻す
    await switchProvider(client, "adguardvpn");
    try {
      const adguard = await client.post("/v1/session", null);
      expect(adguard.ok, "AdGuard VPN のログインに失敗").toBe(true);
    } finally {
      await switchProvider(client, "protonvpn");
    }
  });

  test.afterAll(async () => {
    await ensureDisconnected(client).catch(() => undefined);
    await setMockControl("protonvpn", {}).catch(() => undefined);
    await setMockControl("adguardvpn", {}).catch(() => undefined);
    await switchProvider(client, "protonvpn").catch(() => undefined);
    await ensureDisconnected(client).catch(() => undefined);
  });

  test("ProtonVPN: 国の行は、都市とサーバの段がある国を示す（1.1・2.1）", async () => {
    await switchProvider(client, "protonvpn");
    const res = await client.get<Country[]>("/v1/connection/locations");
    expect(res.ok).toBe(true);
    const jp = res.ok ? res.body.find((item) => item.country === "jp") : undefined;
    expect(jp, "日本の国の行が無い").toBeTruthy();
    expect(jp?.hasServerStage).toBe(true);
  });

  test("ProtonVPN: 国の都市の一覧は、都市名と行の状態を返す（5.1）", async () => {
    const res = await client.get<City[]>("/v1/connection/locations/jp/cities");
    expect(res.ok).toBe(true);
    const names = res.ok ? res.body.map((item) => item.city) : [];
    expect(names).toEqual(expect.arrayContaining(["Tokyo", "Osaka"]));
    const tokyo = res.ok ? res.body.find((item) => item.city === "Tokyo") : undefined;
    expect(tokyo?.id).toBe("jp-tokyo");
  });

  test("ProtonVPN: 都市のサーバは Secure Core を除き、Score の小さい順に並ぶ（3.1）", async () => {
    const res = await client.get<Server[]>("/v1/connection/locations/jp-tokyo/servers");
    expect(res.ok).toBe(true);
    const names = res.ok ? res.body.map((item) => item.name) : [];
    expect(names).not.toContain("JP-TK#3");
    expect(names.slice(0, 2)).toEqual(["JP-TK#1", "JP-TK#2"]);
  });

  test("ProtonVPN: 都市を［接続］すると、その都市の最速サーバへ接続する（2.3・6.1）", async () => {
    const res = await client.put<Connection>("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    expect(res.ok, "都市への接続に失敗").toBe(true);
    await waitForConnection(client, "connected");
    const state = await client.get<Connection>("/v1/connection");
    expect(state.ok && state.body.location).toContain("JP-TK#1");
    expect(state.ok && state.body.locationId).toBe("jp-tokyo");
    await ensureDisconnected(client);
  });

  test("ProtonVPN: サーバを選んで［接続］すると、そのサーバ名で接続する（3.7・6.3）", async () => {
    const res = await client.put<Connection>("/v1/connection", { connect: true, locationId: "srv-jp-tk-2" });
    expect(res.ok, "サーバへの接続に失敗").toBe(true);
    await waitForConnection(client, "connected");
    const state = await client.get<Connection>("/v1/connection");
    expect(state.ok && state.body.location).toContain("JP-TK#2");
    await ensureDisconnected(client);
  });

  test("ProtonVPN: サーバのお気に入りは、登録・一覧・解除を行える（4.4・4.7）", async () => {
    const body = { id: "srv-jp-tk-2", kind: "server", country: "jp", countryName: "Japan", city: "Tokyo", serverName: "JP-TK#2" };
    const add = await client.put(`/v1/connection/locations/srv-jp-tk-2/favorite`, body);
    expect(add.ok).toBe(true);
    const listed = await client.get<Favorite[]>("/v1/connection/favorites");
    expect(listed.ok && listed.body.some((item) => item.id === "srv-jp-tk-2" && item.kind === "server")).toBe(true);
    const remove = await client.delete(`/v1/connection/locations/srv-jp-tk-2/favorite`);
    expect(remove.ok).toBe(true);
  });

  test("ProtonVPN: 一覧に無いサーバのお気に入りは、接続せず失敗し、お気に入りを残す（4.7）", async () => {
    const body = { id: "srv-jp-zz-9", kind: "server", country: "jp", countryName: "Japan", city: "Tokyo", serverName: "JP-ZZ#9" };
    const add = await client.put(`/v1/connection/locations/srv-jp-zz-9/favorite`, body);
    expect(add.ok).toBe(true);
    const res = await client.put("/v1/connection", { connect: true, locationId: "srv-jp-zz-9" });
    expect(res.ok, "一覧に無いお気に入りは接続できてはならない").toBe(false);
    const state = await client.get<Connection>("/v1/connection");
    expect(state.ok && state.body.status).toBe("disconnected");
    const listed = await client.get<Favorite[]>("/v1/connection/favorites");
    expect(listed.ok && listed.body.some((item) => item.id === "srv-jp-zz-9")).toBe(true);
    await client.delete(`/v1/connection/locations/srv-jp-zz-9/favorite`);
  });

  test("AdGuard VPN: 都市の一覧と都市名での接続（2.2・6.2）", async () => {
    await switchProvider(client, "adguardvpn");
    const countries = await client.get<Country[]>("/v1/connection/locations");
    expect(countries.ok && countries.body.find((item) => item.country === "jp")?.hasServerStage).toBe(false);
    const cities = await client.get<City[]>("/v1/connection/locations/jp/cities");
    expect(cities.ok).toBe(true);
    const tokyo = cities.ok ? cities.body.find((item) => item.city === "Tokyo") : undefined;
    expect(tokyo?.id).toBe("jp-tokyo");
    const res = await client.put<Connection>("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    expect(res.ok, "AdGuard VPN の都市への接続に失敗").toBe(true);
    await waitForConnection(client, "connected");
    const state = await client.get<Connection>("/v1/connection");
    expect(state.ok && state.body.location).toContain("TOKYO");
    await ensureDisconnected(client);
  });

  test("AdGuard VPN: サーバの段が無いため、サーバの一覧は得られない（2.2）", async () => {
    const res = await client.get("/v1/connection/locations/jp-tokyo/servers");
    expect(res.ok).toBe(false);
    await switchProvider(client, "protonvpn");
  });
});
