// 責務: ゲートウェイ機の再起動（`POST /v1/gateway/reboot`）のリクエスト/レスポンスのTypeBoxスキーマ定義。
import { Type, type Static } from "@sinclair/typebox";

export const GatewayRebootBodySchema = Type.Object({
  password: Type.String({ minLength: 1, maxLength: 512 }),
});
export type GatewayRebootBody = Static<typeof GatewayRebootBodySchema>;

export const GatewayRebootResultSchema = Type.Object({
  requested: Type.Boolean(),
});
export type GatewayRebootResult = Static<typeof GatewayRebootResultSchema>;
