// 責務: 稼働状況取得（`GET /v1/connection/gateway`）のレスポンスのTypeBoxスキーマ定義。
// プロキシ内部エンドポイント`GET /status`のレスポンス検証（proxy-client.ts）とOpenAPI公開の双方の唯一の情報源。
// Phase 4で`explicitProxy`を追加できるよう、ルート直下は機能ごとのオブジェクトとする（apiserver/design.md参照）。

import { Type, type Static } from "@sinclair/typebox";

export const TransparentGatewayStatusSchema = Type.Object({
  // active: nftルール適用中 / stopped: 無効 / unconfigured: 有効設定だがLAN_IFACE未設定 /
  // error: 有効設定だが直近のnft適用が失敗（ルールの実態が不明）。
  state: Type.Union([
    Type.Literal("active"),
    Type.Literal("stopped"),
    Type.Literal("unconfigured"),
    Type.Literal("error"),
  ]),
  // 検出中のVPNトンネルIF名。未接続時は含まれない。
  vpnInterface: Type.Optional(Type.String()),
  // Kill Switchによりforwardが遮断中か。
  killSwitchBlocking: Type.Boolean(),
});

export const GatewayStatusSchema = Type.Object({
  transparentGateway: TransparentGatewayStatusSchema,
});
export type GatewayStatus = Static<typeof GatewayStatusSchema>;
