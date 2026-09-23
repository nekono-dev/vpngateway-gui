// 責務: `/runners/<ベンダーID>/*`のパス判定（matchRunnerPath）と、対応するランナーのUDSへの転送
// （forwardToRunner）の単体テスト。転送先はテスト用の一時UDSサーバで模擬する。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer, request, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { forwardToRunner, matchRunnerPath } from "./runner-forward.js";

describe("matchRunnerPath", () => {
  it("/runners/<ベンダーID>/<サブパス>に一致すれば取り出す", () => {
    expect(matchRunnerPath("/runners/adguardvpn/exec")).toEqual({ vendorId: "adguardvpn", runnerPath: "/exec" });
    expect(matchRunnerPath("/runners/mockproton/health")).toEqual({ vendorId: "mockproton", runnerPath: "/health" });
  });

  it("サブパスが無い・形式が異なる場合はundefined", () => {
    expect(matchRunnerPath("/runners/adguardvpn")).toBeUndefined();
    expect(matchRunnerPath("/net/status")).toBeUndefined();
    expect(matchRunnerPath(undefined)).toBeUndefined();
  });
});

describe("forwardToRunner", () => {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-runner-forward-"));
  const socketPath = join(dir, "runner-testvendor.sock");
  process.env.CTL_SOCKET_DIR = dir;

  let runnerServer: Server;

  beforeAll(async () => {
    runnerServer = createHttpServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => runnerServer.listen(socketPath, resolve));
  });

  afterAll(() => {
    runnerServer.close();
  });

  /** 転送用のダミーフロントサーバ（forwardToRunnerをそのまま呼ぶ）へGETし、ステータス・本文を返す。 */
  function requestViaFrontend(): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const frontend = createHttpServer((req, res) => forwardToRunner("testvendor", "/health", req, res));
      frontend.listen(0, "127.0.0.1", () => {
        const port = (frontend.address() as AddressInfo).port;
        const req = request({ host: "127.0.0.1", port, path: "/anything", method: "GET" }, (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
          res.on("end", () => {
            frontend.close();
            resolve({ status: res.statusCode ?? 0, body: data });
          });
        });
        req.on("error", (error) => {
          frontend.close();
          reject(error);
        });
        req.end();
      });
    });
  }

  it("対応するランナーのUDSへ転送し、応答をそのまま中継する", async () => {
    const { status, body } = await requestViaFrontend();
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
  });

  it("対応するソケットが無いベンダーは502を返す", async () => {
    const frontend = createHttpServer((req, res) => forwardToRunner("no-such-vendor", "/health", req, res));
    await new Promise<void>((resolve) => frontend.listen(0, "127.0.0.1", resolve));
    const port = (frontend.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/anything", method: "GET" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end();
    });
    frontend.close();
    expect(status).toBe(502);
  });
});
