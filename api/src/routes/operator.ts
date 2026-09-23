// 責務: Web UI利用者の単一管理者アカウント（状態確認・初回作成・変更）。
// apiserver/design.md「Web UI利用者の認証」`GET/POST/PUT /v1/operator`に対応する。
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { OperatorCreateBodySchema, OperatorStateSchema, OperatorUpdateBodySchema } from "../schemas/operator.js";
import {
  createOperatorAccount,
  getOperatorAccount,
  updateOperatorAccount,
  verifyOperatorPassword,
} from "../auth/operator-account-store.js";
import { buildSessionCookie, createSession, isValidSession, readSessionIdFromCookieHeader } from "../auth/session-store.js";
import { isRateLimited, recordFailure, clearFailures } from "../auth/login-rate-limiter.js";
import { UnauthenticatedError, RateLimitedError, OperatorValidationError } from "../errors.js";

export const registerOperatorRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    "/v1/operator",
    { schema: { response: { 200: OperatorStateSchema } } },
    async (request) => {
      const account = getOperatorAccount();
      if (!account) {
        return { configured: false };
      }
      const sessionId = readSessionIdFromCookieHeader(request.headers.cookie);
      if (isValidSession(sessionId)) {
        return { configured: true, username: account.username };
      }
      return { configured: true };
    },
  );

  // 未作成時のみ許可（既に作成済みならOperatorAlreadyConfiguredError→409。requireOperatorSessionの
  // preHandlerはこのルートを素通しするため、認証済み判定自体はここで行わない）。
  fastify.post(
    "/v1/operator",
    {
      schema: {
        body: OperatorCreateBodySchema,
        response: { 200: OperatorStateSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      createOperatorAccount(request.body.username, request.body.password);
      const sessionId = createSession();
      reply.header("set-cookie", buildSessionCookie(sessionId, request.protocol === "https"));
      return { configured: true, username: request.body.username };
    },
  );

  fastify.put(
    "/v1/operator",
    {
      schema: {
        body: OperatorUpdateBodySchema,
        response: { 200: OperatorStateSchema, 400: ErrorResponseSchema, 401: ErrorResponseSchema, 429: ErrorResponseSchema },
      },
    },
    async (request) => {
      const ip = request.ip;
      if (isRateLimited(ip)) {
        throw new RateLimitedError("too many failed attempts, try again later");
      }
      const account = getOperatorAccount();
      if (!account || !verifyOperatorPassword(account.username, request.body.currentPassword)) {
        recordFailure(ip);
        throw new UnauthenticatedError("current password is incorrect");
      }
      clearFailures(ip);
      if (request.body.username === undefined && request.body.newPassword === undefined) {
        throw new OperatorValidationError("username or newPassword is required");
      }
      updateOperatorAccount({ username: request.body.username, newPassword: request.body.newPassword });
      const updated = getOperatorAccount();
      return { configured: true, username: updated?.username };
    },
  );
};
