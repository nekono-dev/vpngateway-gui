// 責務: 操作（オペレーション）ごとの実行可否（`GET /v1/connection/capabilities`）のTypeBoxスキーマ定義。
// キーはcapabilities/operations.tsのOPERATION_KEYSと一致させる（全キーを常に返す）。
import { Type, type Static } from "@sinclair/typebox";

export const CapabilitySchema = Type.Object({
  available: Type.Boolean(),
  // 実行不可の原因。unsupported=プロバイダ非対応、notLoggedIn=未ログイン、planRestricted=プラン制限。
  reason: Type.Optional(
    Type.Union([Type.Literal("unsupported"), Type.Literal("notLoggedIn"), Type.Literal("planRestricted")]),
  ),
  // 利用者向けの理由文。実行不可のときのみ含まれる。
  message: Type.Optional(Type.String()),
});

export const CapabilitiesResponseSchema = Type.Object({
  capabilities: Type.Object({
    login: CapabilitySchema,
    logout: CapabilitySchema,
    connectToLocation: CapabilitySchema,
    connectAuto: CapabilitySchema,
    changeLocation: CapabilitySchema,
    disconnect: CapabilitySchema,
    locationList: CapabilitySchema,
    locationFavorites: CapabilitySchema,
    pingMeasurement: CapabilitySchema,
  }),
});
export type CapabilitiesResponse = Static<typeof CapabilitiesResponseSchema>;
