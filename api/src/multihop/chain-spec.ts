// 責務: 多段接続の経路の指定（出口と段ごとの指定）のスキーマと型を定義する。計算や副作用は持たない。
// 段の選び方と提供元の組み合わせは、判別可能な共用体で表し、手動選択の接続先の有無を型で強制する。

import { Type, type Static } from "@sinclair/typebox";

// 提供元の指定。"exit"＝出口と同じ提供元（既定）、"any"＝全提供元の候補、それ以外はベンダーID。
export const HopProviderSchema = Type.String({ pattern: "^(exit|any|[a-z][a-z0-9]{0,31})$" });
export type HopProvider = Static<typeof HopProviderSchema>;

// 段の切断時の動作。"blockAll"＝どの段の切断でも遮断（既定）、"dropHop"＝この段を外して残りで継続。
export const HopFailurePolicySchema = Type.Union([Type.Literal("blockAll"), Type.Literal("dropHop")]);
export type HopFailurePolicy = Static<typeof HopFailurePolicySchema>;

const ChainLocationIdSchema = Type.String({ minLength: 1, maxLength: 128 });

// 接続先を利用者が選ぶ段（手動選択）。接続先の指定が必須。
const ManualHopSchema = Type.Object(
  {
    selection: Type.Literal("manual"),
    provider: HopProviderSchema,
    manualLocationId: ChainLocationIdSchema,
    onFailure: HopFailurePolicySchema,
  },
  { additionalProperties: false },
);

// 接続先を選び方で決める段（ランダム・プロバイダ選択）。接続先の指定は持たない。
const AutoHopSchema = Type.Object(
  {
    selection: Type.Union([Type.Literal("random"), Type.Literal("provider")]),
    provider: HopProviderSchema,
    onFailure: HopFailurePolicySchema,
  },
  { additionalProperties: false },
);

export const HopSpecSchema = Type.Union([ManualHopSchema, AutoHopSchema]);
export type HopSpec = Static<typeof HopSpecSchema>;

// 経路の指定。hops は出口に近い順（hops[0] が出口の 1 つ前）。hops が空なら段数 1（出口だけ）。
export const ChainSpecSchema = Type.Object(
  {
    exit: Type.Object({ locationId: ChainLocationIdSchema }, { additionalProperties: false }),
    hops: Type.Array(HopSpecSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type ChainSpec = Static<typeof ChainSpecSchema>;
