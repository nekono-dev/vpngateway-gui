// 責務: VPN アカウントのログイン・ログアウトと、接続・切断・接続ログ・ランナー停止時の試験（stack 群・api）。
// 要件 3.1〜3.7。ベンダーは protonvpn（モック CLI）。認証情報はモックが受け付ける値（実アカウントは使わない）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { apiClient, loadAdmin, runnerContainer, setMockControl } from "../../fixtures/stack";
import type { ApiClient, ApiResult } from "../../../common/api-client";
import { firstLocationId } from "../../fixtures/gateway";

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

/** 目的: runner の制御 socket に内部 exec 要求を送り、HTTP status と JSON 応答を得る。 */
async function requestRunnerExec(binary: string): Promise<{ status: number; body: { error?: string; exitCode?: number } }> {
  const script = `
    const http = require('node:http');
    const body = JSON.stringify({ vendor: 'protonvpn', binary: ${JSON.stringify(binary)}, resolvedArgv: ['status'], timeoutMs: 10000 });
    const request = http.request({ socketPath: process.env.CTL_SOCKET_PATH, path: '/exec', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => process.stdout.write(JSON.stringify({ status: response.statusCode, body: JSON.parse(data) })));
    });
    request.on('error', error => { process.stderr.write(error.message); process.exitCode = 1; });
    request.end(body);
  `;
  const { stdout } = await run("sudo", ["docker", "exec", runnerContainer("protonvpn"), "node", "-e", script]);
  return JSON.parse(stdout) as { status: number; body: { error?: string; exitCode?: number } };
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

  test("3.1: 選択した都市へ接続すると接続済みとなり、接続ログが得られる", async () => {
    try {
      const id = await firstLocationId(client);
      const connect = await client.put<ConnectionBody>("/v1/connection", { connect: true, locationId: id });
      expect(connect.ok, `接続に失敗: ${JSON.stringify(connect)}`).toBe(true);
      const connected = await client.get<ConnectionBody>("/v1/connection");
      expect(connected.ok && connected.body.status).toBe("connected");

      const log = await client.get<unknown[]>("/v1/connection/log");
      expect(log.ok && Array.isArray(log.body) && log.body.length > 0).toBe(true);
    } finally {
      const disconnect = await client.put<ConnectionBody>("/v1/connection", { connect: false });
      expect(disconnect.ok, "接続シナリオの後始末で切断できない").toBe(true);
      const disconnected = await client.get<ConnectionBody>("/v1/connection");
      expect(disconnected.ok && disconnected.body.status).toBe("disconnected");
    }
  });

  test("3.2: 切断すると切断済みになる", async () => {
    const id = await firstLocationId(client);
    const connect = await client.put<ConnectionBody>("/v1/connection", { connect: true, locationId: id });
    expect(connect.ok, "切断シナリオの事前接続に失敗").toBe(true);
    try {
      const disconnect = await client.put<ConnectionBody>("/v1/connection", { connect: false });
      expect(disconnect.ok, "切断に失敗").toBe(true);
      const disconnected = await client.get<ConnectionBody>("/v1/connection");
      expect(disconnected.ok && disconnected.body.status).toBe("disconnected");
    } finally {
      const cleanup = await client.put<ConnectionBody>("/v1/connection", { connect: false });
      expect(cleanup.ok, "切断シナリオの後始末に失敗").toBe(true);
    }
  });

  test("8.8: runner は許可バイナリを実行し、許可外バイナリを拒否する", async () => {
    const allowedBinary = "/usr/bin/protonvpn";
    const allowed = await requestRunnerExec(allowedBinary);
    expect(allowed.status, "許可された runner コマンドが拒否された").toBe(200);

    const rejected = await requestRunnerExec(`${allowedBinary}.not-allowed`);
    expect(rejected.status, "許可外 runner コマンドが拒否されなかった").toBe(403);
    expect(rejected.body.error).toBe("binary_not_allowed");
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
