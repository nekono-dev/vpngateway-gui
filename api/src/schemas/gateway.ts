// 責務: 稼働状況取得（`GET /v1/connection/gateway`）のレスポンスのTypeBoxスキーマ定義。
// プロキシ内部エンドポイント`GET /status`のレスポンス検証（proxy-client.ts）とOpenAPI公開の双方の唯一の情報源。
// ルート直下は機能ごとのオブジェクト（透過ゲートウェイ・Phase 4で追加した明示的プロキシ。apiserver/design.md参照）。

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
  // フェイルオープン中（VPN未接続・killSwitch=false）に実際にパケットを送出しているWAN側インターフェース名。
  // それ以外の場合は含まれない。
  wanInterface: Type.Optional(Type.String()),
  // Kill Switchによりforwardが遮断中か。
  killSwitchBlocking: Type.Boolean(),
});

export const ExplicitProxyStatusSchema = Type.Object({
  // active: 稼働中（一時的な再起動待ちを含む） / stopped: 無効 / unconfigured: 有効設定だが許可CIDRが空 /
  // crashLoop: 起動直後の異常終了を連続して繰り返している / error: 設定ファイルの生成・書き込みに失敗。
  state: Type.Union([
    Type.Literal("active"),
    Type.Literal("stopped"),
    Type.Literal("unconfigured"),
    Type.Literal("crashLoop"),
    Type.Literal("error"),
  ]),
  // 待ち受けポート。稼働中（state=active）のみ含まれる。
  socksPort: Type.Optional(Type.Integer()),
  httpPort: Type.Optional(Type.Integer()),
  // プロキシ起動以降の異常終了による再起動回数（設定変更による意図的な再起動は含まない）。
  restartCount: Type.Integer(),
});

export const GatewayStatusSchema = Type.Object({
  transparentGateway: TransparentGatewayStatusSchema,
  explicitProxy: ExplicitProxyStatusSchema,
  // LAN側のネットワークCIDR（例: 192.168.3.0/24）。ゲートウェイ機がLAN_IFACE未設定、またはIPv4アドレスを
  // 検出できない場合は含まれない。Web UIの設定ダイアログで、明示的プロキシの許可CIDR欄の初期値に使う
  // （webserver/requirements.md「明示的プロキシの許可CIDRの初期値」）。
  lanCidr: Type.Optional(Type.String()),
});
export type GatewayStatus = Static<typeof GatewayStatusSchema>;
