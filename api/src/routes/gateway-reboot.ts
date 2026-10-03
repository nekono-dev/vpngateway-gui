// 責務: ゲートウェイ機（ベアメタル）の再起動の依頼。apiserver/design.md「ゲートウェイ機の再起動」に対応する。
// 利用者のパスワードを再入力させ、検証したうえで`proxy`へ依頼する（再起動の実行はホスト側が行う）。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import { GatewayRebootBodySchema, GatewayRebootResultSchema } from "../schemas/gateway-reboot.js";
import { getOperatorAccount, verifyOperatorPassword } from "../auth/operator-account-store.js";
import { clearFailures, isRateLimited, recordFailure } from "../auth/login-rate-limiter.js";
import { RateLimitedError, UnauthenticatedError } from "../errors.js";
import { requestGatewayReboot } from "../proxy-client/proxy-client.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";

export const registerGatewayRebootRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    "/v1/gateway/reboot",
    {
      schema: {
        body: GatewayRebootBodySchema,
        response: {
          202: GatewayRebootResultSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
          429: ErrorResponseSchema,
          502: ErrorResponseSchema,
          503: ErrorResponseSchema,
          504: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ip = request.ip;
      if (isRateLimited(ip)) {
        throw new RateLimitedError("too many failed attempts, try again later");
      }
      const account = getOperatorAccount();
      if (!account || !verifyOperatorPassword(account.username, request.body.password)) {
        recordFailure(ip);
        throw new UnauthenticatedError("password is incorrect");
      }
      clearFailures(ip);
      try {
        await requestGatewayReboot();
      } catch (error) {
        // パスワードは記録しない。失敗の理由のみを残す。
        appendAuditLog({ action: "gateway_reboot", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      appendAuditLog({ action: "gateway_reboot", exitCode: 0 });
      reply.code(202);
      return { requested: true };
    },
  );
};
