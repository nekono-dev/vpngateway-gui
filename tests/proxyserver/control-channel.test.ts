// 責務: 制御チャネル（相互TLS）・ランナー宛の転送・ホスト再起動の依頼・コンテナ権限の受け入れテスト。
// 受け入れ条件 proxyserver/AC-11・AC-12・AC-15・AC-22 を、実際にネットワークコンテナの起点を起動して確認する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { request } from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestPki } from "../helpers/pki.js";
import { readRepoFile, repoPath } from "../helpers/repo.js";

const gatewayPki = createTestPki("gateway");
const otherPki = createTestPki("other");
const workDir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-control-"));
const pkiDir = join(workDir, "pki");
const socketDir = join(workDir, "sockets");
const hostCtlDir = join(workDir, "host-ctl");
let child: ChildProcess;
let runnerServer: Server;
let port = 0;

/** 目的: 空いているポート番号を1つ得る。 */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port: found } = server.address() as { port: number };
      server.close(() => resolve(found));
    });
  });
}

interface Credentials {
  cert?: string;
  key?: string;
}

/**
 * 目的: 制御チャネルへHTTPSで要求を送る。
 * 入力: method, path, credentials(クライアント証明書。省略すると証明書なし)。信頼する認証局はゲートウェイの認証局。
 * 出力: ステータスと本文。TLSの確立または送信に失敗すると例外。
 */
function call(method: string, path: string, credentials: Credentials = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        ca: readFileSync(gatewayPki.caCert),
        cert: credentials.cert === undefined ? undefined : readFileSync(credentials.cert),
        key: credentials.key === undefined ? undefined : readFileSync(credentials.key),
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const validClient: Credentials = { cert: gatewayPki.clientCert, key: gatewayPki.clientKey };

beforeAll(async () => {
  // サーバが読む証明書の置き場（既定のファイル名）を用意する。
  mkdirSync(pkiDir, { recursive: true });
  copyFileSync(gatewayPki.caCert, join(pkiDir, "gateway-ca.crt"));
  copyFileSync(gatewayPki.serverCert, join(pkiDir, "proxy-server.crt"));
  copyFileSync(gatewayPki.serverKey, join(pkiDir, "proxy-server.key"));
  mkdirSync(socketDir, { recursive: true });
  mkdirSync(hostCtlDir, { recursive: true });
  // 対応するランナーの代役（UDSで待ち受けて応答する）。
  runnerServer = createHttpServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, from: "runner" }));
  });
  await new Promise<void>((resolve) => runnerServer.listen(join(socketDir, "runner-testvendor.sock"), resolve));
  port = await freePort();
  child = spawn(repoPath("node_modules/.bin/tsx"), [repoPath("proxy/src/server.ts")], {
    env: {
      ...process.env,
      GATEWAY_PORT: String(port),
      GATEWAY_PKI_DIR: pkiDir,
      CTL_SOCKET_DIR: socketDir,
      HOST_CTL_DIR: hostCtlDir,
      LAN_IFACE: "",
      CONNECTION_POLL_INTERVAL_MS: "3600000",
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  // 起動の完了（監査ログのserver_started）を待つ。
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 20000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("server_started")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

afterAll(() => {
  child.kill("SIGTERM");
  runnerServer.close();
});

describe("制御チャネル", () => {
  it("proxyserver/AC-11: 証明書を持たない接続と別の認証局の証明書での接続は拒否され、正しい証明書の接続は応答を得る", async () => {
    await expect(call("GET", "/net/status")).rejects.toThrow();
    await expect(call("GET", "/net/status", { cert: otherPki.clientCert, key: otherPki.clientKey })).rejects.toThrow();
    const accepted = await call("GET", "/net/status", validClient);
    expect(accepted.status).toBe(200);
    expect(JSON.parse(accepted.body)).toMatchObject({ transparentGateway: { state: "stopped" } });
    // 存在しない経路は404で、内部の情報を返さない。
    expect((await call("GET", "/net/unknown", validClient)).status).toBe(404);
  });

  it("proxyserver/AC-12: ランナー宛の要求は対応するランナーのソケットへ転送され、ソケットが無いと502になる", async () => {
    const forwarded = await call("GET", "/runners/testvendor/health", validClient);
    expect(forwarded.status).toBe(200);
    expect(JSON.parse(forwarded.body)).toEqual({ ok: true, from: "runner" });
    expect((await call("GET", "/runners/missingvendor/health", validClient)).status).toBe(502);
    // ソケットのディレクトリの外を指す名前は、転送の対象にならない。
    expect((await call("GET", "/runners/..%2F..%2Fetc/health", validClient)).status).toBe(404);
  });

  it("proxyserver/AC-15: 再起動の依頼は依頼ファイルを作成し、再度の依頼は拒否され、置き場が無ければ利用不可になる", async () => {
    const first = await call("POST", "/net/host-reboot", validClient);
    expect(first.status).toBe(202);
    expect(JSON.parse(first.body)).toEqual({ requested: true });
    expect(existsSync(join(hostCtlDir, "reboot-request"))).toBe(true);
    expect((await call("POST", "/net/host-reboot", validClient)).status).toBe(409);
    // ホスト側の仕組みが無い（置き場が存在しない）環境では、依頼を受け付けない。
    rmSync(hostCtlDir, { recursive: true });
    const unavailable = await call("POST", "/net/host-reboot", validClient);
    expect(unavailable.status).toBe(503);
    expect(JSON.parse(unavailable.body)).toEqual({ error: "host_control_unavailable" });
  });

  it("proxyserver/AC-22: コンテナ定義が追加する権限は1種類で、特権モードを指定しない", () => {
    const compose = readRepoFile("compose/gateway.yml");
    expect(compose).not.toMatch(/^\s+privileged:/m);
    const capAdd = /^\s+cap_add:\n((?:\s+- .+\n)+)/m.exec(compose);
    expect(capAdd?.[1]?.split("\n").filter(Boolean).map((line) => line.trim())).toEqual(["- NET_ADMIN"]);
  });
});
