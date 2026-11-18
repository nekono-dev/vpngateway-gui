// 責務: API Fastify アプリを HTTP listener として起動する。

import type { FastifyInstance, FastifyListenOptions } from "fastify";
import { buildApp } from "./app.js";

/**
 * 目的: API アプリを内部 HTTP listener として起動する。
 * 入力: env（listen port の既定値に使う環境変数）、listenOptions（テスト時などの listener 設定）。
 * 出力: listen 済みの Fastify インスタンス。
 */
export async function startApiServer(
  env: NodeJS.ProcessEnv = process.env,
  listenOptions: FastifyListenOptions = { port: Number(env.PORT ?? 3000), host: "0.0.0.0" },
): Promise<FastifyInstance> {
  const app = buildApp();
  await app.listen(listenOptions);
  return app;
}
