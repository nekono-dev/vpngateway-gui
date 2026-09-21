// 責務: ベンダーの一覧・切替（`/v1/providers`）のTypeBoxスキーマ定義（apiserver/design.md「ベンダーの選択」）。
import { Type, type Static } from "@sinclair/typebox";

export const ProviderSchema = Type.Object({
  id: Type.String(),
  displayName: Type.String(),
  // 選択中のベンダーか（高々1件がtrue）。
  active: Type.Boolean(),
  // そのベンダーのランナーが応答するか。falseのベンダーへは切り替えられない。
  available: Type.Boolean(),
  unavailableReason: Type.Optional(Type.String()),
});
export type ProviderItem = Static<typeof ProviderSchema>;

// 有効化された順。
export const ProvidersResponseSchema = Type.Array(ProviderSchema);

export const ActiveProviderBodySchema = Type.Object({
  providerId: Type.String({ pattern: "^[a-z][a-z0-9]{0,31}$" }),
});

export const ActiveProviderSchema = Type.Object({
  id: Type.String(),
  displayName: Type.String(),
});
