// 責務: 接続・操作履歴（監査ログ）の取得。apiserver/design.md`GET /v1/connection/log`に対応する。

import type { FastifyPluginAsync } from "fastify";
import { AuditLogResponseSchema } from "../schemas/audit-log.js";
import { readAuditLog } from "../audit-log/audit-log-store.js";

export const registerConnectionLogRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/v1/connection/log",
    { schema: { response: { 200: AuditLogResponseSchema } } },
    async () => readAuditLog(),
  );
};
