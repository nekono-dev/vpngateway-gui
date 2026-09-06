// 責務: 監査ログ（コマンド実行要求・結果の記録）のTypeBoxスキーマ定義。

import { Type, type Static } from "@sinclair/typebox";

export const AuditLogEntrySchema = Type.Object({
  timestamp: Type.String(),
  action: Type.String(),
  input: Type.Optional(Type.Unknown()),
  exitCode: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
});
export type AuditLogEntry = Static<typeof AuditLogEntrySchema>;

export const AuditLogResponseSchema = Type.Array(AuditLogEntrySchema);
