// 責務: Web UI利用者のログイン状態（`/v1/operator`のサブリソース）。
// apiserver/design.md「Web UI利用者の認証」`POST/GET/DELETE /v1/operator/session`に対応する。
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { OperatorSessionLoginBodySchema, OperatorSessionStateSchema } from "../schemas/operator.js";
import { verifyOperatorPassword } from "../auth/operator-account-store.js";
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSession,
  deleteSession,
  readSessionIdFromCookieHeader,
} from "../auth/session-store.js";
import { isRateLimited, recordFailure, clearFailures } from "../auth/login-rate-limiter.js";
import { UnauthenticatedError, RateLimitedError } from "../errors.js";

export const registerOperatorSessionRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    "/v1/operator/session",
    {
      schema: {
        body: OperatorSessionLoginBodySchema,
        response: { 200: OperatorSessionStateSchema, 401: ErrorResponseSchema, 429: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const ip = request.ip;
      if (isRateLimited(ip)) {
        throw new RateLimitedError("too many failed attempts, try again later");
      }
      const { username, password } = request.body;
      // アカウント未作成であること自体は`GET /v1/operator`の`configured`で判別させ、
      // ログイン失敗の応答からは区別できないようにする（apiserver/design.md）。
      if (!verifyOperatorPassword(username, password)) {
        recordFailure(ip);
        throw new UnauthenticatedError("username or password is incorrect");
      }
      clearFailures(ip);
      const sessionId = createSession();
      reply.header("set-cookie", buildSessionCookie(sessionId, request.protocol === "https"));
      return { authenticated: true };
    },
  );

  // requireOperatorSessionのpreHandlerが未認証を401にするため、ここに到達する時点で認証済み
  // （401はpreHandlerが送出するUnauthenticatedError→ErrorResponseSchema。OpenAPI仕様・生成クライアントの
  // 型に反映するため、ここにも宣言する）。
  fastify.get(
    "/v1/operator/session",
    { schema: { response: { 200: OperatorSessionStateSchema, 401: ErrorResponseSchema } } },
    async () => ({ authenticated: true }),
  );

  fastify.delete(
    "/v1/operator/session",
    { schema: { response: { 200: OperatorSessionStateSchema } } },
    async (request, reply) => {
      const sessionId = readSessionIdFromCookieHeader(request.headers.cookie);
      deleteSession(sessionId);
      reply.header("set-cookie", buildExpiredSessionCookie(request.protocol === "https"));
      return { authenticated: false };
    },
  );
};
