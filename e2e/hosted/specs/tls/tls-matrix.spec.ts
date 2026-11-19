// 責務: Web HTTPS と Gateway TLS の hosted matrix、および証明書・保護方式の失敗を独立に確認する。
// ブラウザの CA trust は run.sh 経由で準備する。単独実行では ON 系ケースが証明書信頼エラーになる。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, expect } from "../../fixtures/web.js";
import { loadAdmin } from "../../fixtures/stack.js";
import { composeArgs, HOSTED_COMPOSE_FRAGMENTS } from "../../fixtures/compose.js";
import { composePsArgs, parseComposePs, type ComposeServiceState } from "../../lib/docker-compose-result.js";

const root = process.cwd();
const certDir = resolve("e2e/hosted/.work/tls-matrix");
const port = process.env.E2E_WEB_PORT ?? "18080";
const baseFragments = [...HOSTED_COMPOSE_FRAGMENTS];
type TlsCase = { readonly name: string; readonly web: boolean; readonly gateway: boolean; readonly variant?: string };
type TlsStartResult = {
  readonly started: boolean;
  readonly exitCodes: Readonly<Record<string, number>>;
  readonly logs: string;
  readonly states: readonly ComposeServiceState[];
  readonly origin: string;
  readonly failure?: { readonly phase: "compose-up" | "api-state" | "origin" | "timeout"; readonly message: string };
};

let activeSetup: ReturnType<typeof config> | undefined;

function command(args: readonly string[], env: NodeJS.ProcessEnv): { code: number; output: string } {
  const result = spawnSync("docker", [...args], { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  return { code: result.status ?? 127, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function config(case_: TlsCase): { fragments: string[]; env: NodeJS.ProcessEnv; origin: string; override?: string } {
  const fragments: string[] = [...baseFragments];
  if (case_.web) fragments.push("compose/web-tls.yml");
  if (case_.gateway) fragments.push("compose/api-tls.yml");
  const variant = case_.variant;
  const badDir = join(certDir, "invalid");
  let override: string | undefined;
  if (variant === "missing-client") {
    // API の client certificate/key 設定だけを空にし、正規 CA mount と proxy 側の証明書 mount は維持する。
    override = join(certDir, "missing-client-override.yml");
    writeFileSync(override, [
      "services:",
      "  api:",
      "    environment:",
      "      GATEWAY_TLS_CLIENT_CERT_FILE: ''",
      "      GATEWAY_TLS_CLIENT_KEY_FILE: ''",
      "",
    ].join("\n"));
    fragments.push(override);
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WEB_PORT: port,
    WEB_HTTPS_ENABLED: String(case_.web),
    GATEWAY_TLS_ENABLED: String(case_.gateway),
    WEB_TLS_CERT_HOST_PATH: join(certDir, "web/server.crt"),
    WEB_TLS_KEY_HOST_PATH: join(certDir, "web/server.key"),
    // compose/api-tls.yml はこの CA を API の Gateway server trust と proxy の API client trust の両方へ mount する。常に正規 CA を使う。
    GATEWAY_TLS_CA_HOST_PATH: join(certDir, "gateway/ca.crt"),
    GATEWAY_TLS_CLIENT_CERT_HOST_PATH: join(certDir, "gateway/api-client.crt"),
    GATEWAY_TLS_CLIENT_KEY_HOST_PATH: join(certDir, "gateway/api-client.key"),
    // compose/api-tls.yml の proxy server cert/key mount だけを variant ごとに差し替える。API client cert/key は正規 CA 署名のまま。
    GATEWAY_TLS_SERVER_CERT_HOST_PATH: variant === "wrong-ca" ? join(badDir, "wrong-ca-server.crt") : variant === "expired" ? join(badDir, "expired-server.crt") : variant === "san-mismatch" ? join(badDir, "san-mismatch.crt") : join(certDir, "gateway/server.crt"),
    GATEWAY_TLS_SERVER_KEY_HOST_PATH: variant === "wrong-ca" ? join(badDir, "wrong-ca-server.key") : variant === "expired" ? join(badDir, "expired-server.key") : variant === "san-mismatch" ? join(badDir, "san-mismatch.key") : join(certDir, "gateway/server.key"),
    GATEWAY_TLS_SERVER_NAME: "gateway.local",
  };
  return { fragments, env, origin: `${case_.web ? "https" : "http"}://127.0.0.1:${port}`, ...(override === undefined ? {} : { override }) };
}

function readStates(fragments: readonly string[], env: NodeJS.ProcessEnv): { code: number; states: ComposeServiceState[]; output: string } {
  const result = command(composePsArgs(composeArgs([], fragments)), env);
  if (result.code !== 0) return { code: result.code, states: [], output: result.output };
  return { code: result.code, states: parseComposePs(result.output), output: result.output };
}

function originProbe(origin: string, webTls: boolean): { ok: boolean; detail: string } {
  const args = ["--silent", "--show-error", "--noproxy", "*", "--max-time", "2", "--output", "/dev/null", "--write-out", "%{http_code}"];
  if (webTls) args.push("--cacert", join(certDir, "web/ca.crt"));
  args.push(origin);
  const result = spawnSync("curl", args, { cwd: root, encoding: "utf8", env: process.env });
  const status = (result.stdout ?? "").trim();
  const detail = `curl exit=${result.status ?? 127} HTTP=${status || "none"}${result.stderr ? ` ${result.stderr.trim()}` : ""}`;
  return { ok: result.status === 0 && status === "200", detail };
}

function captureTlsDiagnostics(): void {
  if (activeSetup === undefined) return;
  const out = resolve("e2e/artifacts/hosted/tls/diag");
  mkdirSync(out, { recursive: true });
  const ps = command(composePsArgs(composeArgs([], activeSetup.fragments)), activeSetup.env);
  writeFileSync(join(out, "compose-ps.txt"), `exit=${ps.code}\n${ps.output || "(no compose ps output)"}\n`);
  const logs = command(composeArgs(["logs", "--no-color", "--tail", "300"], activeSetup.fragments), activeSetup.env);
  writeFileSync(join(out, "compose-logs.txt"), `exit=${logs.code}\n${logs.output || "(no compose logs output)"}\n`);
  writeFileSync(join(out, "tls-start-context.txt"), `origin=${activeSetup.origin}\ncompose-ps-exit=${ps.code}\ncompose-logs-exit=${logs.code}\n`);
}

async function start(case_: TlsCase, apiTlsOverride = false): Promise<TlsStartResult> {
  const setup = config(case_);
  let fragments = setup.fragments;
  if (apiTlsOverride) {
    const override = join(certDir, "api-mode-override.yml");
    writeFileSync(override, "services:\n  api:\n    environment:\n      GATEWAY_TLS_ENABLED: 'false'\n");
    fragments = [...fragments, override];
  }
  activeSetup = { ...setup, fragments };
  command(composeArgs(["down"], fragments), setup.env);
  const up = command(composeArgs(["up", "-d"], fragments), setup.env);
  const exitCodes: Record<string, number> = { up: up.code };
  let logs = up.output;
  let states: ComposeServiceState[] = [];
  let lastProbe = "origin not probed";
  const deadline = Date.now() + 90_000;
  const withLogs = (current: string): string => {
    const diagnostic = command(composeArgs(["logs", "--no-color", "--tail", "300"], fragments), setup.env);
    return `${current}\ncompose logs exit=${diagnostic.code}\n${diagnostic.output}`;
  };
  while (Date.now() < deadline) {
    const current = readStates(fragments, setup.env);
    states = current.states;
    if (current.code !== 0) logs += `\nps failed (${current.code}): ${current.output}`;
    for (const service of states) exitCodes[service.service] = service.exitCode;
    const api = states.find((state) => state.service === "api");
    if (up.code !== 0) {
      return { started: false, exitCodes, logs: withLogs(logs), states, origin: setup.origin, failure: { phase: "compose-up", message: `docker compose up exited ${up.code}` } };
    }
    if (api?.state === "exited" || api?.state === "restarting") {
      if (case_.variant === "missing-client") {
        return { started: false, exitCodes, logs: withLogs(logs), states, origin: setup.origin, failure: { phase: "api-state", message: `expected fail-closed API state: ${api.state}` } };
      }
      return { started: false, exitCodes, logs: withLogs(logs), states, origin: setup.origin, failure: { phase: "api-state", message: `API entered ${api.state}` } };
    }
    if (api?.state === "running") {
      const probe = originProbe(setup.origin, case_.web);
      lastProbe = probe.detail;
      if (probe.ok) return { started: true, exitCodes, logs, states, origin: setup.origin };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return { started: false, exitCodes, logs: withLogs(`${logs}\nWeb origin did not answer before deadline: ${lastProbe}`), states, origin: setup.origin, failure: { phase: "timeout", message: `Web origin readiness timed out: ${lastProbe}` } };
}

async function loginAndCheck(page: import("@playwright/test").Page, origin: string): Promise<void> {
  const admin = await loadAdmin();
  await page.goto(origin);
  await page.getByLabel("ユーザー名").fill(admin.username);
  await page.getByLabel("パスワード", { exact: true }).fill(admin.password);
  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/operator") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^ログイン/ }).click();
  const loginResponse = await loginResponsePromise;
  // headers() は set-cookie を含まないため、全ヘッダーを取得できる headerValue で読む
  await expectSessionCookieSecurity((await loginResponse.headerValue("set-cookie")) ?? undefined, origin.startsWith("https://"));
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  const apiStatus = await page.evaluate(async () => (await fetch("/api/v1/operator")).status);
  expect(apiStatus).toBe(200);
}

async function expectSessionCookieSecurity(setCookie: string | undefined, secureExpected: boolean): Promise<void> {
  expect(setCookie).toBeDefined();
  const hasSecure = /(?:^|;)\s*secure(?:;|$)/i.test(setCookie ?? "");
  expect(hasSecure).toBe(secureExpected);
}

async function checkGatewayStatusAndControl(page: import("@playwright/test").Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/v1/connection/gateway");
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  });
  expect(status.status).toBe(200);
  const guard = status.body.gatewayGuard as Record<string, unknown> | undefined;
  expect(guard).toBeDefined();
  expect(["UNKNOWN", "BLOCK", "LEASE", "OFF"]).toContain(guard?.state);
  expect(typeof guard?.healthy).toBe("boolean");
  expect(typeof guard?.leaseValid).toBe("boolean");
  expect(guard?.lastUpdatedAt === null || typeof guard?.lastUpdatedAt === "string").toBe(true);

  const original = await page.evaluate(async () => {
    const response = await fetch("/api/v1/connection/config");
    return await response.json() as { killSwitch: boolean };
  });
  const update = async () => page.evaluate(async (killSwitch) => {
    const response = await fetch("/api/v1/connection/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ killSwitch }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }, original.killSwitch);

  try {
    const control = await update();
    expect(control.status).toBe(200);
    expect(control.body.killSwitch).toBe(original.killSwitch);
  } finally {
    const restored = await update();
    expect(restored.status).toBe(200);
    expect(restored.body.killSwitch).toBe(original.killSwitch);
  }
}

test.describe.serial("Web HTTPS × Gateway TLS", () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    if (!existsSync(join(certDir, "web/ca.crt"))) {
      const result = spawnSync("sh", ["e2e/hosted/lib/tls-matrix-certs.sh", certDir], { cwd: root, stdio: "inherit" });
      if (result.status !== 0) throw new Error(`TLS matrix 証明書の生成に失敗しました (exit ${result.status ?? 127})`);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) captureTlsDiagnostics();
  });

  test.afterAll(() => {
    try {
      const { fragments, env } = config({ name: "cleanup", web: false, gateway: false });
      command(composeArgs(["down"], fragments), env);
    } finally {
      rmSync(join(certDir, "api-mode-override.yml"), { force: true });
      rmSync(join(certDir, "missing-client-override.yml"), { force: true });
    }
  });

  for (const row of [
    { name: "OFF/OFF", web: false, gateway: false },
    { name: "ON/OFF", web: true, gateway: false },
    { name: "OFF/ON", web: false, gateway: true },
    { name: "ON/ON", web: true, gateway: true },
  ] satisfies TlsCase[]) {
    test(`${row.name}: browser 認証と API 操作が成功し、平文降格しない`, async ({ page }) => {
      const result = await start(row);
      expect(result.started, `failure=${JSON.stringify(result.failure)}; up=${result.exitCodes.up}; logs=${result.logs}`).toBe(true);
      await loginAndCheck(page, result.origin);
      await checkGatewayStatusAndControl(page);
      if (row.web) {
        await expect(fetch(`http://127.0.0.1:${port}/`).then(() => "connected", () => "refused")).resolves.toBe("refused");
      } else {
        await expect(fetch(`https://127.0.0.1:${port}/`).then(() => "connected", () => "refused")).resolves.toBe("refused");
      }
    });
  }

  for (const [variant, expectedCause] of [
    ["wrong-ca", /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN/],
    ["expired", /CERT_HAS_EXPIRED/],
    ["san-mismatch", /ERR_TLS_CERT_ALTNAME_INVALID/],
  ] as const) {
    test(`Gateway ${variant}: TLS client が API 操作を拒否し、HTTP へ降格しない`, async ({ page }) => {
      const result = await start({ name: variant, web: false, gateway: true, variant });
      expect(result.started, `failure=${JSON.stringify(result.failure)}; up=${result.exitCodes.up}; logs=${result.logs}`).toBe(true);
      expect(result.states.find((state) => state.service === "api")?.state).toBe("running");
      await loginAndCheck(page, result.origin);
      const requestStartedAt = new Date().toISOString();
      const gatewayResponse = await page.evaluate(async () => {
        const response = await fetch("/api/v1/connection/gateway");
        return { status: response.status, body: await response.json() as { error?: string; protectionModeMismatch?: boolean; message?: string } };
      });
      expect(gatewayResponse.status).toBe(502);
      expect(gatewayResponse.body.error).toBe("proxy_unavailable");
      expect(gatewayResponse.body.protectionModeMismatch).not.toBe(true);
      expect(gatewayResponse.body.message).toContain("gateway control channel");
      const { fragments, env } = config({ name: variant, web: false, gateway: true, variant });
      const diagnostic = command(composeArgs(["logs", "--no-color", "--since", requestStartedAt, "api"], fragments), env);
      expect(diagnostic.code, diagnostic.output).toBe(0);
      expect(diagnostic.output).toMatch(expectedCause);
      expect(diagnostic.output).toContain("gateway_tls_validation_failed");
      expect(diagnostic.output).not.toContain("protection_mode_mismatch");
      await expect(fetch(`http://127.0.0.1:${port}/`).then(() => "connected", () => "refused")).resolves.toBe("refused");
    });
  }

  test("Gateway missing-client: API が client 証明書なしで起動を拒否し、原因と終了状態を記録する", async () => {
    const result = await start({ name: "missing-client", web: false, gateway: true, variant: "missing-client" });
    expect(result.started).toBe(false);
    expect(result.exitCodes.up).toBe(0);
    expect(result.exitCodes.api).toBeGreaterThan(0);
    expect(result.states.find((state) => state.service === "api")?.state).toMatch(/exited|restarting/);
    expect(result.logs).toContain(
      "Gateway TLS configuration missing required environment variables: GATEWAY_TLS_CLIENT_CERT_FILE, GATEWAY_TLS_CLIENT_KEY_FILE",
    );
  });

  test("API/Gateway TLS mismatch: 専用状態と UI 表示を示し、HTTP へ降格しない", async ({ page }) => {
    const result = await start({ name: "mode-mismatch", web: false, gateway: true }, true);
    expect(result.started, `failure=${JSON.stringify(result.failure)}; up=${result.exitCodes.up}; logs=${result.logs}`).toBe(true);
    await loginAndCheck(page, result.origin);
    await expect(page.getByText("API と Gateway の通信保護設定が一致しません")).toBeVisible();
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/v1/connection/gateway");
      return { status: response.status, body: await response.json() as { error?: string; protectionModeMismatch?: boolean } };
    });
    expect(status).toEqual({ status: 502, body: { error: "gateway_protection_mismatch", message: "API と Gateway の通信保護設定が一致しません", protectionModeMismatch: true } });
    const mismatchConfig = config({ name: "mode-mismatch", web: false, gateway: true });
    mismatchConfig.fragments.push(join(certDir, "api-mode-override.yml"));
    expect(command(composeArgs(["logs", "--no-color", "api"], mismatchConfig.fragments), mismatchConfig.env).output).toContain("protection_mode_mismatch");
    await expect(fetch(`http://127.0.0.1:${port}/`).then(() => "connected", () => "refused")).resolves.toBe("refused");
  });
});
