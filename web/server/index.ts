// 責務: ビルド済みSPAの配信と、`/api/*`のAPIコンテナへのリバースプロキシ。
// ブラウザは常にこのサーバの単一オリジンにのみアクセスする（webserver/design.md参照）。
// 通信路の保護（specs/webserver/requirements.md）: ブラウザ⇄webはHTTPS（自己署名サーバ証明書）、
// web⇄apiもHTTPSとし、APIサーバの証明書を`api-ca`で検証する（検証を無効化しない）。

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadApiCaCertificate, loadWebServerTlsOptions } from "./tls-options.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(currentDir, "..", "dist");

const app = Fastify({ logger: true, https: loadWebServerTlsOptions() });

app.register(fastifyHttpProxy, {
  upstream: process.env.API_ORIGIN ?? "https://api:3000",
  prefix: "/api",
  rewritePrefix: "",
  // @fastify/http-proxyは既定でundici（Agent）を使って上流へ接続する。connect.caでAPIサーバの
  // 証明書をapi-caで検証する。内部で使う@fastify/reply-fromは、undiciのtls.rejectUnauthorizedを
  // 明示しないと無効（false）にするため、検証を有効にすることを明示する（tlsとconnectの両方）。
  // `tls`は@fastify/reply-fromがundiciへ渡す独自の指定で、型定義には含まれないためキャストする。
  undici: {
    tls: { rejectUnauthorized: true },
    connect: { ca: loadApiCaCertificate(), rejectUnauthorized: true },
  } as never,
  // 上流（APIサーバ）へ到達できない・証明書の検証に失敗した場合は、原因によらず502で応答する
  // （ブラウザからは「APIサーバに到達できない」という同じ事象として扱えるようにする）。
  replyOptions: {
    onError: (reply, { error }) => {
      reply.log.warn({ err: error }, "failed to proxy request to the API server");
      reply.code(502).send({ error: "bad_gateway" });
    },
  },
});

app.register(fastifyStatic, {
  root: staticRoot,
  index: "index.html",
});

// SPAのクライアントサイドルーティングのため、静的ファイルに一致しないGETはindex.htmlへフォールバックする。
app.setNotFoundHandler((request, reply) => {
  if (request.method === "GET" && !request.url.startsWith("/api")) {
    reply.sendFile("index.html");
    return;
  }
  reply.code(404).send({ error: "not_found" });
});

const port = Number(process.env.PORT ?? 8080);
app.listen({ port, host: "0.0.0.0" }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
