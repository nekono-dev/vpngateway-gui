// 責務: Fastifyアプリケーションの構築。ルート登録、OpenAPI仕様生成、エラーハンドリングの一元化を行う。

import Fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { registerConnectionCountriesRoute } from "./routes/connection-countries.js";
import { registerConnectionRoute } from "./routes/connection.js";
import { registerConnectionConfigRoute } from "./routes/connection-config.js";
import { registerConnectionLogRoute } from "./routes/connection-log.js";
import { PlaceholderValidationError } from "./profile/placeholder-resolver.js";
import { SettingsValidationError } from "./settings/settings-store.js";
import { ProxyUnavailableError, ProxyTimeoutError, CommandExecutionError } from "./errors.js";

/**
 * 目的: Fastifyアプリケーションのインスタンスを構築する（listenはしない）。
 * 入力: なし。
 * 出力: ルート登録・エラーハンドラ設定済みのFastifyインスタンス。
 * 例: const app = buildApp(); await app.listen({ port: 3000 });
 */
export function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>();

  app.register(fastifySwagger, {
    openapi: {
      info: { title: "VPNGateway-GUI API", version: "0.1.0" },
    },
  });

  // apiserver/design.md「エラーハンドリング方針」に基づくエラー種別→HTTPステータスのマッピング。
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PlaceholderValidationError || error instanceof SettingsValidationError) {
      reply.code(400).send({ error: "invalid_input", message: error.message });
      return;
    }
    if (error instanceof ProxyUnavailableError) {
      reply.code(502).send({ error: "proxy_unavailable", message: error.message });
      return;
    }
    if (error instanceof ProxyTimeoutError) {
      reply.code(504).send({ error: "proxy_timeout", message: error.message });
      return;
    }
    if (error instanceof CommandExecutionError) {
      reply.code(422).send({ error: "command_failed", exitCode: error.exitCode, stderr: error.stderr });
      return;
    }
    request.log.error(error);
    reply.code(500).send({ error: "internal_error" });
  });

  app.get("/openapi.json", async () => app.swagger());

  app.register(registerConnectionCountriesRoute);
  app.register(registerConnectionRoute);
  app.register(registerConnectionConfigRoute);
  app.register(registerConnectionLogRoute);

  return app;
}
