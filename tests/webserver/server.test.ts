// 責務: Webサーバ（`web/server/index.ts`）の配信とAPIサーバへの転送の受け入れテスト。
// 受け入れ条件 webserver/AC-1・AC-2 を、実際に起動したWebサーバへHTTPSで要求して確認する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer, request, type Server } from "node:https";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestPki } from "../helpers/pki.js";
import { repoPath } from "../helpers/repo.js";

// ブラウザ⇄Webの片方向TLS（Webの証明書）と、Web⇄APIの片方向TLS（APIの証明書とその認証局）は別の認証局にする。
const webPki = createTestPki("web");
const apiPki = createTestPki("api");
const otherPki = createTestPki("other");
const workDir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-web-"));
let apiStub: Server;
let webProcess: ChildProcess | undefined;
let unreachableWebProcess: ChildProcess | undefined;
let webPort = 0;
let wrongCaWebPort = 0;
const received: Array<{ url: string | undefined; cookie: string | undefined }> = [];

/** 目的: 空いているポート番号を1つ得る。 */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** 目的: Webサーバを起動し、監査ログ（Fastifyのログ）に待受の開始が出るまで待つ。 */
async function startWeb(port: number, apiOrigin: string, apiCa: string): Promise<ChildProcess> {
  const child = spawn(repoPath("node_modules/.bin/tsx"), [repoPath("web/server/index.ts")], {
    env: {
      ...process.env,
      PORT: String(port),
      API_ORIGIN: apiOrigin,
      API_TLS_CA_FILE: apiCa,
      WEB_TLS_CERT_FILE: webPki.serverCert,
      WEB_TLS_KEY_FILE: webPki.serverKey,
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("web server did not start")), 20000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("Server listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return child;
}

/** 目的: Webサーバへ（Webの認証局を信頼して）要求を送り、ステータスと本文を返す。 */
function call(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers, ca: readFileSync(webPki.caCert) }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  // 配信する画面（ビルド済みの静的ファイル）が無ければ、ビルドする。
  if (!existsSync(repoPath("web/dist/index.html"))) {
    const built = spawnSync("npm", ["run", "build", "-w", "web"], { cwd: repoPath("."), encoding: "utf8" });
    if (built.status !== 0) throw new Error(`web build failed: ${built.stderr}`);
  }
  // APIサーバの代役（HTTPS）。受け取ったパスとCookieを記録する。
  apiStub = createHttpsServer({ key: readFileSync(apiPki.serverKey), cert: readFileSync(apiPki.serverCert) }, (req, res) => {
    received.push({ url: req.url, cookie: req.headers.cookie });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ configured: true }));
  });
  await new Promise<void>((resolve) => apiStub.listen(0, "127.0.0.1", resolve));
  const apiPort = (apiStub.address() as AddressInfo).port;
  // Web⇄APIは、APIの認証局で検証する。
  const caForWeb = join(workDir, "api-ca.crt");
  mkdirSync(workDir, { recursive: true });
  copyFileSync(apiPki.caCert, caForWeb);
  webPort = await freePort();
  webProcess = await startWeb(webPort, `https://127.0.0.1:${apiPort}`, caForWeb);
  // 別の認証局だけを信頼するWebサーバ（APIの証明書の検証に失敗する構成）。
  wrongCaWebPort = await freePort();
  unreachableWebProcess = await startWeb(wrongCaWebPort, `https://127.0.0.1:${apiPort}`, otherPki.caCert);
});

afterAll(() => {
  webProcess?.kill("SIGTERM");
  unreachableWebProcess?.kill("SIGTERM");
  apiStub.closeAllConnections();
  apiStub.close();
});

describe("Webサーバの配信と転送", () => {
  it("webserver/AC-1: API用のパス配下の要求は、サーバ証明書を検証してAPIサーバへ転送され、Cookieがそのまま渡る", async () => {
    const response = await call(webPort, "/api/v1/operator", { cookie: "vpngwgui_session=abc123" });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ configured: true });
    // 接頭辞（/api）を除いて転送され、Cookieは解釈されずにそのまま渡る。
    expect(received.at(-1)).toEqual({ url: "/v1/operator", cookie: "vpngwgui_session=abc123" });
  });

  it("webserver/AC-2: 静的ファイルに一致しないGETは画面の入口へ戻され、API用のパス配下で転送先に到達できないときは502になる", async () => {
    const entrance = await call(webPort, "/");
    expect(entrance.status).toBe(200);
    expect(entrance.body).toContain('<div id="root">');
    // クライアント側のルーティングの経路は、画面の入口と同じ内容を返す。
    expect((await call(webPort, "/settings/some-page")).body).toBe(entrance.body);
    // APIサーバの証明書を検証できない構成では、転送せず502になり、APIサーバは1件も受け取らない。
    const before = received.length;
    const failed = await call(wrongCaWebPort, "/api/v1/operator");
    expect(failed.status).toBe(502);
    expect(received.length).toBe(before);
  });
});
