// 責務: 管理者向け設定「VPNクライアント操作プロファイル」JSONのTypeBoxスキーマ定義。
// apiserver/design.md「管理者向け設定」参照。argv配列ベースで保持し、シェル文字列は扱わない。

import { Type, type Static } from "@sinclair/typebox";

export const PlaceholderDefSchema = Type.Object({
  pattern: Type.String(),
  source: Type.Literal("enum"),
  enumFrom: Type.String(),
});

export const ActionDefSchema = Type.Object({
  argv: Type.Array(Type.String()),
  placeholders: Type.Record(Type.String(), PlaceholderDefSchema),
  timeoutMs: Type.Number(),
});
export type ActionDef = Static<typeof ActionDefSchema>;

// Phase 1では"json"のみ許可する。Phase 4で実VPNベンダーCLI統合時に"text"等を追加し、
// 対応するパーサーをresponse-parser.tsに追加する（wbs/phase1.md「全体整合性レビューでの指摘」参照）。
export const OutputFormatSchema = Type.Literal("json");

export const VendorProfileSchema = Type.Object({
  vendor: Type.String(),
  binary: Type.String(),
  outputFormat: OutputFormatSchema,
  actions: Type.Object({
    connect: ActionDefSchema,
    disconnect: ActionDefSchema,
    status: ActionDefSchema,
  }),
  countries: Type.Array(Type.String()),
});
export type VendorProfile = Static<typeof VendorProfileSchema>;
