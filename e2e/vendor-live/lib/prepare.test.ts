// 責務: 準備処理の単体テスト。CA で検証できない API では、資格情報の入力画面を出さずに中止すること（要件 1.7・1.8）を確かめる。
// 実際の TLS サーバを一時的に立て、別の CA を渡して検証の失敗を再現する（秘密は使わない）。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyTransport, prepare, probeApi } from "./prepare";
import type { LiveConfig } from "./config";
import type { PrepareIo } from "./prepare-types";

let dir: string;
let server: Server;
let baseUrl = "";
let otherCaPath: string;
let serverCaPath: string;
const requestPaths: string[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "prepare-test-"));
  // 正しい CA（サーバ証明書の発行元）と、無関係な CA を作る
  execFileSync("sh", ["e2e/hosted/lib/certs.sh", dir], { stdio: "ignore" });
  serverCaPath = join(dir, "ca.crt");
  const other = join(dir, "other");
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", `${other}.key`, "-out", `${other}.crt`, "-days", "1", "-subj", "/CN=other-ca"], { stdio: "ignore" });
  otherCaPath = `${other}.crt`;
  // 到達の確認（GET /v1/operator）は通し、管理者の認証（POST）は拒否する
  server = createServer({ key: readFileSync(join(dir, "server.key")), cert: readFileSync(join(dir, "server.crt")) }, (req, res) => {
    requestPaths.push(req.url ?? "");
    res.writeHead(req.method === "GET" ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_credentials", message: "認証に失敗" }));
  });
  return new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    }),
  );
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function config(webCaPath?: string): LiveConfig {
  return { webBaseUrl: baseUrl, ...(webCaPath === undefined ? {} : { webCaPath }), artifactsDir: join(dir, "artifacts") };
}

/** 入力を呼んだ回数を数える端末（資格情報の入力画面が出たかを確かめる）。 */
function spyIo(): PrepareIo & { hiddenCalls: number } {
  const io = {
    hiddenCalls: 0,
    hidden: async () => {
      io.hiddenCalls += 1;
      return "";
    },
    visible: async () => "y",
    print: () => undefined,
  };
  return io;
}

describe("classifyTransport", () => {
  it("証明書の検証の失敗は ca-untrusted、それ以外の到達の失敗は api-unreachable とする", () => {
    expect(classifyTransport({ ok: false, kind: "transport", code: "DEPTH_ZERO_SELF_SIGNED_CERT" } as never)).toEqual({ kind: "ca-untrusted" });
    expect(classifyTransport({ ok: false, kind: "transport", code: "CERT_HAS_EXPIRED" } as never)).toEqual({ kind: "ca-untrusted" });
    expect(classifyTransport({ ok: false, kind: "transport", code: "ECONNREFUSED" } as never)).toEqual({ kind: "api-unreachable" });
  });
});

describe("prepare（段の中止）", () => {
  it("Web CA で検証できない Web origin では、資格情報の入力を求めずに api の段で中止する", async () => {
    const io = spyIo();
    const outcome = await prepare(config(otherCaPath), "protonvpn", {
      io,
      fetchPublicIp: async () => "203.0.113.1",
      now: () => new Date(0),
    });
    expect(outcome).toEqual({ ok: false, step: "api", reason: { kind: "ca-untrusted" } });
    expect(io.hiddenCalls).toBe(0);
  });

  it("Web CA が正しければ Web origin の API 段を通過する（管理者の入力へ進む）", async () => {
    const io = spyIo();
    // 管理者の入力を 2 回求めた後、API が拒否して operator の段で止まる
    const outcome = await prepare(config(serverCaPath), "protonvpn", {
      io,
      fetchPublicIp: async () => "203.0.113.1",
      now: () => new Date(0),
    });
    expect(io.hiddenCalls).toBe(2);
    expect(requestPaths).toContain("/api/v1/operator");
    expect(requestPaths).toContain("/api/v1/operator/session");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.step).toBe("operator");
  });
});

describe("任意の Web CA", () => {
  it("指定した Web CA のファイルが読めなければ、通信せずに ca-untrusted で中止する", async () => {
    const outcome = await probeApi({ webBaseUrl: baseUrl, webCaPath: join(dir, "missing-ca.crt"), artifactsDir: dir });
    expect(outcome).toEqual({ ok: false, reason: { kind: "ca-untrusted" } });
  });

  it("Web CA 未指定時は標準 trust store で検証し、自己署名証明書を信頼しない", async () => {
    const io = spyIo();
    const outcome = await prepare({ webBaseUrl: baseUrl, artifactsDir: dir }, "protonvpn", {
      io,
      fetchPublicIp: async () => "203.0.113.1",
      now: () => new Date(0),
    });
    expect(outcome).toEqual({ ok: false, step: "api", reason: { kind: "ca-untrusted" } });
    expect(io.hiddenCalls).toBe(0);
  });
});
