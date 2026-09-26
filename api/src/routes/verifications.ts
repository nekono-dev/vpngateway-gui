// 責務: 設定の動作検証（Phase 27）の開始・進行と結果の取得・ブラウザの観測の提出。apiserver/design.md「設定の動作検証」の
// 「エンドポイント」に対応する。検証の実行・保持はVerificationService（verification/verification-service.ts）が担う。

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ErrorResponseSchema } from "../schemas/connection.js";
import {
  EgressIpObservationResultSchema,
  EgressIpObservationSchema,
  VerificationIdParamsSchema,
  VerificationSchema,
} from "../schemas/verification.js";
import { getSettings } from "../settings/settings-store.js";
import { fetchCheckNonce, registerCheckNonce, runGatewayCheck } from "../proxy-client/proxy-client.js";
import { appendAuditLog } from "../audit-log/audit-log-store.js";
import { isIpv4Address } from "../lib/ipv4-address.js";
import { VerificationService } from "../verification/verification-service.js";

// APIサーバのプロセスで1つ（検証の同時実行を1件に制限し、直近の結果を保持する）。
const verificationService = new VerificationService({
  runGatewayCheck: (input) => runGatewayCheck(input),
  registerCheckNonce: (name, ttlSeconds) => registerCheckNonce(name, ttlSeconds),
  fetchCheckNonce: (name) => fetchCheckNonce(name),
  appendAuditLog: (entry) => appendAuditLog(entry),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

export const registerVerificationsRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  // 検証の開始。保存済みの設定に対して検証する。
  fastify.post(
    "/v1/verifications",
    { schema: { response: { 202: VerificationSchema, 409: ErrorResponseSchema } } },
    async (_request, reply) => {
      const verification = await verificationService.start(getSettings());
      reply.code(202);
      return verification;
    },
  );

  fastify.get(
    "/v1/verifications/:id",
    { schema: { params: VerificationIdParamsSchema, response: { 200: VerificationSchema, 404: ErrorResponseSchema } } },
    async (request, reply) => {
      const verification = verificationService.get(request.params.id);
      if (verification === undefined) {
        reply.code(404);
        return { error: "not_found", message: "verification not found" };
      }
      return verification;
    },
  );

  // ブラウザがIP確認サービスから得た出口IP（取得に失敗した場合はnull）の提出。最初の提出のみ採用する。
  fastify.put(
    "/v1/verifications/:id/client-observations/egress-ip",
    {
      schema: {
        params: VerificationIdParamsSchema,
        body: EgressIpObservationSchema,
        response: { 200: EgressIpObservationResultSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const { ip } = request.body;
      if (ip !== null && !isIpv4Address(ip)) {
        reply.code(400);
        return { error: "invalid_input", message: "ip must be an IPv4 address or null" };
      }
      const accepted = verificationService.submitEgressIp(request.params.id, ip);
      if (accepted === undefined) {
        reply.code(404);
        return { error: "not_found", message: "verification not found" };
      }
      return { accepted };
    },
  );
};
