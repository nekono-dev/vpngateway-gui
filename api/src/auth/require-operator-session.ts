// 責務: セッションCookieによる`/v1/*`全体の認可（`preHandler`フック）。
// apiserver/design.md「Web UI利用者の認証」: `GET/POST /v1/operator`（未作成時のみ許可、実際の409判定は
// ルート側）・`POST /v1/operator/session`を除く全ての`/v1/*`ルートへ適用する。

import type { FastifyRequest, FastifyReply } from "fastify";
import { UnauthenticatedError } from "../errors.js";
import { isValidSession, readSessionIdFromCookieHeader } from "./session-store.js";

const UNAUTHENTICATED_ROUTES: ReadonlySet<string> = new Set([
  "GET /v1/operator",
  "POST /v1/operator",
  "POST /v1/operator/session",
]);

/**
 * 目的: リクエストが有効なセッションCookieを持つかを検証する（`app.ts`から`preHandler`として全ルートへ登録）。
 * 入力: request, reply(未使用。フックの型に合わせて受け取る)。
 * 出力: なし。
 * 失敗時の方針: `/v1/*`以外（`/openapi.json`等）、および認証不要な一部の`/v1/operator*`ルートは素通しする。
 *              それ以外でセッションCookieが欠如・不正なら、呼び出し元（app.ts）が401へマッピングする
 *              UnauthenticatedErrorを投げる。
 */
export async function requireOperatorSession(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const routePath = request.routeOptions.url ?? request.url;
  if (!routePath.startsWith("/v1/")) {
    return;
  }
  const routeKey = `${request.method} ${routePath}`;
  if (UNAUTHENTICATED_ROUTES.has(routeKey)) {
    return;
  }
  const sessionId = readSessionIdFromCookieHeader(request.headers.cookie);
  if (!isValidSession(sessionId)) {
    throw new UnauthenticatedError("valid session cookie is required");
  }
}
