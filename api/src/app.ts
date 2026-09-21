// 責務: Fastifyアプリケーションの構築。ルート登録、OpenAPI仕様生成、エラーハンドリングの一元化を行う。

import Fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { registerConnectionLocationsRoute } from "./routes/connection-locations.js";
import { registerConnectionRoute } from "./routes/connection.js";
import { registerConnectionCapabilitiesRoute } from "./routes/connection-capabilities.js";
import { registerConnectionAvailableLocationsRoute } from "./routes/connection-available-locations.js";
import { registerConnectionConfigRoute } from "./routes/connection-config.js";
import { registerConnectionGatewayRoute } from "./routes/connection-gateway.js";
import { registerConnectionLogRoute } from "./routes/connection-log.js";
import { registerProvidersRoute } from "./routes/providers.js";
import { registerSessionRoute } from "./routes/session.js";
import { PlaceholderValidationError } from "./profile/placeholder-resolver.js";
import { SettingsValidationError } from "./settings/settings-store.js";
import { FavoriteLocationsError } from "./locations/favorite-locations-store.js";
import {
  ProxyUnavailableError,
  ProxyTimeoutError,
  CommandExecutionError,
  OperationRestrictedError,
  OperationUnsupportedError,
  ProviderSwitchingError,
} from "./errors.js";

/**
 * 目的: Fastifyのスキーマ検証（body・params等）が失敗して投げられたエラーかを判定する。
 * 入力: error(エラーハンドラへ渡された値。unknown)。期待する形状: 検証失敗時は`validation`配列を持つオブジェクト。
 * 出力: スキーマ検証エラーなら true。
 */
function isSchemaValidationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "validation" in error;
}

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
    // スキーマ検証（body・パスパラメータ）の失敗もFastifyが`validation`を付けて渡す。入力エラーとして400にする。
    if (
      error instanceof PlaceholderValidationError ||
      error instanceof SettingsValidationError ||
      error instanceof FavoriteLocationsError ||
      isSchemaValidationError(error)
    ) {
      reply.code(400).send({ error: "invalid_input", message: (error as Error).message });
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
    // プラン制限による失敗（restrictedPattern一致）は通常の実行失敗（422）と区別して403で通知する。
    if (error instanceof OperationRestrictedError) {
      reply
        .code(403)
        .send({ error: "operation_restricted", message: error.message, exitCode: error.exitCode, stderr: error.stderr });
      return;
    }
    // プロファイルがその操作に対応するアクションを持たない（プロバイダ非対応）。
    if (error instanceof OperationUnsupportedError) {
      reply.code(501).send({ error: "operation_unsupported", message: error.message });
      return;
    }
    if (error instanceof ProviderSwitchingError) {
      reply.code(409).send({ error: "provider_switching", message: error.message });
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

  app.register(registerConnectionLocationsRoute);
  app.register(registerConnectionRoute);
  app.register(registerConnectionCapabilitiesRoute);
  app.register(registerConnectionAvailableLocationsRoute);
  app.register(registerConnectionConfigRoute);
  app.register(registerConnectionLogRoute);
  app.register(registerConnectionGatewayRoute);
  app.register(registerSessionRoute);
  app.register(registerProvidersRoute);

  return app;
}
