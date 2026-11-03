// 責務: VPN アカウントのログイン・ログアウトと、接続・切断・接続ログ・ランナー停止時の試験（stack 群・api）。
// 要件 3.1〜3.7。ベンダーは protonvpn（モック CLI）。認証情報はモックが受け付ける値（実アカウントは使わない）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { apiClient, loadAdmin, runnerContainer, setMockControl } from "../../fixtures/stack";
import type { ApiClient, ApiResult } from "../../../common/api-client";

const run = promisify(execFile);
const MOCK_USER = "mock-user@example.test";
const MOCK_PASSWORD = "mock-password";

type SessionBody = { loggedIn?: boolean; plan?: { id: string } };
type ConnectionBody = { status: "connected" | "disconnected"; locationId?: string };

/**
 * 目的: ランナーが応答するまで接続状態（GET /v1/connection）の取得を再試行する。起動直後は 502 になり得る。
 * 入力: client、timeoutMs（既定 90 秒。超えたら最後の応答を返す）。
 * 出力: 最後に得た応答。
 */
async function readConnectionWhenRunnerReady(client: ApiClient, timeoutMs = 90_000): Promise<ApiResult<ConnectionBody>> {
  const deadline = Date.now() + timeoutMs;
  let res = await client.get<ConnectionBody>("/v1/connection");
  while (!res.ok && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    res = await client.get<ConnectionBody>("/v1/connection");
  }
  return res;
}

/** 目的: 接続先の一覧（GET /v1/connection/locations）の先頭の ID を得る。 */
async function firstLocationId(client: ApiClient): Promise<string> {
  const res = await client.get<{ id: string }[]>("/v1/connection/locations");
  expect(res.ok, "接続先の一覧が得られない").toBe(true);
  const id = res.ok ? res.body[0]?.id : undefined;
  expect(id, "接続先が 1 件も無い").toBeTruthy();
  return id as string;
}

test.describe.serial("VPN アカウントと接続（stack・api）", () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });
  // 同じ Cookie（管理者の session）を、この群のすべての要求で使う
  const client = apiClient();

  test.beforeAll(async () => {
    const admin = await loadAdmin();
    const login = await client.post("/v1/operator/session", admin);
    expect(login.ok, "管理者のログインに失敗").toBe(true);
    const put = await client.put("/v1/providers/active", { providerId: "protonvpn" });
    expect(put.ok, "プロバイダの切り替えに失敗").toBe(true);
  });

  test.afterAll(async () => {
    // 後始末: 制御を解除し、コンテナを起動状態に戻す
    await setMockControl("protonvpn", {}).catch(() => undefined);
    await run("sudo", ["docker", "start", runnerContainer("protonvpn")]).catch(() => undefined);
  });

  test("3.7: 認証情報の誤りでログインに失敗し、ログイン状態は変わらない", async () => {
    // 前提: 未ログイン（前の群の試験がログインを残すことがあるため、ここでログアウトして揃える）
    await client.delete("/v1/session");
    const before = await client.get<SessionBody>("/v1/session");
    expect(before.ok && before.body.loggedIn).toBe(false);
    await setMockControl("protonvpn", { loginFails: true });
    try {
      const res = await client.post("/v1/session", { username: MOCK_USER, password: "wrong", twoFactorCode: "123456" });
      expect(res.ok, "誤った資格情報が成功した").toBe(false);
    } finally {
      await setMockControl("protonvpn", {});
    }
    const state = await client.get<SessionBody>("/v1/session");
    expect(state.ok && state.body.loggedIn === true).toBe(false);
  });

  test("3.5: 認証情報を入力してログインすると、プランが得られる", async () => {
    const res = await client.post("/v1/session", { username: MOCK_USER, password: MOCK_PASSWORD, twoFactorCode: "123456" });
    expect(res.ok, "ログインに失敗").toBe(true);
    const state = await client.get<SessionBody>("/v1/session");
    expect(state.ok && state.body.loggedIn).toBe(true);
    expect(state.ok && state.body.plan?.id).toBeTruthy();
  });

  test("3.1 / 3.2 / 3.4: 接続すると接続済み、切断すると切断、接続ログが得られる", async () => {
    
    const id = await firstLocationId(client);

    const connect = await client.put<ConnectionBody>("/v1/connection", { connect: true, locationId: id });
    expect(connect.ok, "接続に失敗").toBe(true);
    const connected = await client.get<ConnectionBody>("/v1/connection");
    expect(connected.ok && connected.body.status).toBe("connected");

    const log = await client.get<unknown[]>("/v1/connection/log");
    expect(log.ok && Array.isArray(log.body) && log.body.length > 0).toBe(true);

    const disconnect = await client.put<ConnectionBody>("/v1/connection", { connect: false });
    expect(disconnect.ok, "切断に失敗").toBe(true);
    const disconnected = await client.get<ConnectionBody>("/v1/connection");
    expect(disconnected.ok && disconnected.body.status).toBe("disconnected");
  });

  test("3.3: ランナーを止めた状態で接続すると 502 か 504 を返し、接続状態は変わらない", async () => {
    // 接続先の ID は、ランナーを止める前に得る（止めた後は一覧が得られない）
    const id = await firstLocationId(client);
    await run("sudo", ["docker", "stop", runnerContainer("protonvpn")]);
    try {
      const res = await client.put("/v1/connection", { connect: true, locationId: id });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect([502, 504]).toContain(res.kind === "http" ? res.status : 0);
    } finally {
      await run("sudo", ["docker", "start", runnerContainer("protonvpn")]);
    }
    // 接続状態の取得（CLI の status）もランナーを経由するため、起動し直してから状態を確かめる
    const state = await readConnectionWhenRunnerReady(client);
    expect(state.ok && state.body.status).toBe("disconnected");
  });
});
