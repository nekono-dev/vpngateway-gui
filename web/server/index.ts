// 責務: ビルド済みSPAの配信と、`/api/*`のAPIコンテナへのリバースプロキシ。
// ブラウザは常にこのサーバの単一オリジンにのみアクセスする（webserver/design.md参照）。

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(currentDir, "..", "dist");

const app = Fastify({ logger: true });

app.register(fastifyHttpProxy, {
  upstream: process.env.API_ORIGIN ?? "http://api:3000",
  prefix: "/api",
  rewritePrefix: "",
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
