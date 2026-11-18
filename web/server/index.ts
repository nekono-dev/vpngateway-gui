// 責務: Web HTTP/HTTPS listener、ビルド済み SPA 配信、API へのリバースプロキシを起動する。

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadApiCaCertificate, loadWebServerHttpsOptions } from "./tls-options.js";
import type { ListenOptions } from "node:net";

const currentDir = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(currentDir, "..", "dist");

type Environment = NodeJS.ProcessEnv;

/** Web サーバを起動し、待受中の Fastify instance を返す。 */
export async function startWebServer(
  env: Environment = process.env,
  listenOptions: ListenOptions = { port: Number(env.PORT ?? 8080), host: "0.0.0.0" },
): Promise<FastifyInstance> {
  const tlsOptions = loadWebServerHttpsOptions(env);
  const app = (tlsOptions
    ? Fastify({ logger: true, https: tlsOptions })
    : Fastify({ logger: true })) as FastifyInstance;
  const upstream = env.API_ORIGIN ?? "http://api:3000";
  const upstreamOptions = upstream.startsWith("https://") ? {
    undici: {
      tls: { rejectUnauthorized: true },
      connect: { ca: loadApiCaCertificate(), rejectUnauthorized: true },
    } as never,
  } : {};

  app.register(fastifyHttpProxy, {
    upstream,
    prefix: "/api",
    rewritePrefix: "",
    ...upstreamOptions,
    replyOptions: {
      onError: (reply, { error }) => {
        reply.log.warn({ err: error }, "failed to proxy request to the API server");
        reply.code(502).send({ error: "bad_gateway" });
      },
    },
  });
  app.register(fastifyStatic, { root: staticRoot, index: "index.html" });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      reply.sendFile("index.html");
      return;
    }
    reply.code(404).send({ error: "not_found" });
  });

  await app.listen(listenOptions);
  return app;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startWebServer().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
