// 責務: web の中継（/api → API）が、ブラウザの Accept-Language を上流へ届けることを確かめる（本番と同じプラグインと応答の設定。上流は HTTP）。
// TLS の設定（web⇄api の証明書）は、ヘッダの転送に影響しないため、この検査では省く。

import Fastify from "fastify";
import fastifyHttpProxy from "@fastify/http-proxy";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let upstream: Server;
let proxy: ReturnType<typeof Fastify>;
let proxyPort: number;

beforeAll(async () => {
  // 上流（API 相当）: 受け取った Accept-Language を返す。
  upstream = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ acceptLanguage: request.headers["accept-language"] ?? null, path: request.url }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;

  // 中継（web 相当）: server/index.ts と同じ prefix・rewritePrefix・応答の設定。
  proxy = Fastify({ logger: false });
  await proxy.register(fastifyHttpProxy, {
    upstream: `http://127.0.0.1:${upstreamPort}`,
    prefix: "/api",
    rewritePrefix: "",
    replyOptions: {
      onError: (reply) => reply.code(502).send({ error: "bad_gateway" }),
    },
  });
  await proxy.listen({ port: 0, host: "127.0.0.1" });
  proxyPort = (proxy.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await proxy.close();
  upstream.close();
});

/**
 * 目的: 中継へ要求を送り、上流が受け取った Accept-Language を返す。
 * 入力: headers（送るヘッダ）。ヘッダ無しの検査のため、fetch（自動で値を付ける）ではなく node:http を使う。
 */
function viaProxy(headers: Record<string, string>): Promise<{ acceptLanguage: string | null }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port: proxyPort, path: "/api/v1/connection/locations", method: "GET", headers },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve(JSON.parse(data)));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("中継による Accept-Language の転送", () => {
  it("ブラウザの言語設定を、そのまま上流へ届ける", async () => {
    const body = await viaProxy({ "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8" });
    expect(body.acceptLanguage).toBe("ja-JP,ja;q=0.9,en-US;q=0.8");
  });

  it("ヘッダが無ければ、上流にも値を付けない", async () => {
    const body = await viaProxy({});
    expect(body.acceptLanguage).toBeNull();
  });
});
