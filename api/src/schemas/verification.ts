// 責務: 設定の動作検証（`/v1/verifications`、Phase 27）のTypeBoxスキーマ定義。OpenAPI公開とWeb UIの生成クライアントの唯一の情報源。
// 形状はapiserver/design.md「設定の動作検証」の「エンドポイント」に対応する。

import { Type, type Static } from "@sinclair/typebox";
import { Nullable } from "../lib/typebox-nullable.js";

// config: 設定の確認（L1） / gateway: ゲートウェイの通信確認（L2） / client: この端末からの確認（L3）。
export const VerificationGroupSchema = Type.Union([Type.Literal("config"), Type.Literal("gateway"), Type.Literal("client")]);
export type VerificationGroup = Static<typeof VerificationGroupSchema>;

// pending: 待機中 / running: 実行中 / pass: 合格 / fail: 不合格 / unconfirmed: 未確認 / notApplicable: 設定で無効のため対象外。
export const VerificationCheckStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("pass"),
  Type.Literal("fail"),
  Type.Literal("unconfirmed"),
  Type.Literal("notApplicable"),
]);
export type VerificationCheckStatus = Static<typeof VerificationCheckStatusSchema>;

export const VerificationCheckSchema = Type.Object({
  id: Type.String(),
  // 利用者向けの項目名。
  title: Type.String(),
  group: VerificationGroupSchema,
  status: VerificationCheckStatusSchema,
  // 期待した状態・観測した状態・対処の手がかり・未確認/対象外の理由（利用者向けの文言）。
  expected: Type.Optional(Type.String()),
  observed: Type.Optional(Type.String()),
  hint: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
});
export type VerificationCheck = Static<typeof VerificationCheckSchema>;

export const VerificationSchema = Type.Object({
  id: Type.String(),
  // running: 実行中（未確定の項目がある） / completed: すべての項目が確定した。
  state: Type.Union([Type.Literal("running"), Type.Literal("completed")]),
  startedAt: Type.String(),
  finishedAt: Type.Optional(Type.String()),
  // 実行順（対象外の項目も、本来の順番の位置に含める）。
  checks: Type.Array(VerificationCheckSchema),
  // ブラウザが名前解決を起こす検証用の名前（53番リダイレクトの確認が対象のときのみ）。
  clientProbe: Type.Optional(Type.Object({ dnsName: Type.String() })),
});
export type Verification = Static<typeof VerificationSchema>;

export const VerificationIdParamsSchema = Type.Object({
  id: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
});

export const EgressIpObservationResultSchema = Type.Object({
  // 採用したか（最初の提出のみ採用する。2回目以降はfalse）。
  accepted: Type.Boolean(),
});

export const EgressIpObservationSchema = Type.Object({
  // ブラウザがIP確認サービスから得た出口IP（IPv4）。取得に失敗した場合はnull。
  ip: Nullable(Type.String()),
});
