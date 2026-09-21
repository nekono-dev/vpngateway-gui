// 責務: ログイン代行・セッション（`/v1/session`）のリクエスト/レスポンスのTypeBoxスキーマ定義。
import { Type, type Static } from "@sinclair/typebox";

export const SessionResponseSchema = Type.Object({
  // ログインURL。`login`アクションのcompletionPatternに一致し、ブラウザでの認証待ちの間に返す場合のみ含まれる。
  // 既にログイン済みで即座に完了した場合、およびユーザー名・パスワード入力型のログインでは含まれない。
  loginUrl: Type.Optional(Type.String()),
  message: Type.String(),
});
export type SessionResponse = Static<typeof SessionResponseSchema>;

// ユーザー名・パスワード入力型（`loginMethod: "credentials"`）のログイン入力。
// パスワード・2FAコードは秘密情報のため、監査ログ・エラー応答・APIのログへ残さない（apiserver/design.md）。
export const SessionLoginBodySchema = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 256 }),
  password: Type.String({ minLength: 1, maxLength: 512 }),
  // 2段階認証が有効なアカウントのみ。未指定・空文字なら送らない。
  twoFactorCode: Type.Optional(Type.String({ maxLength: 32 })),
});
export type SessionLoginBody = Static<typeof SessionLoginBodySchema>;

// `GET /v1/session`。ログイン状態・プランは`account`アクションで判定できたときのみ含まれる（不明なら省略）。
export const SessionStateSchema = Type.Object({
  loginMethod: Type.Union([Type.Literal("deviceUrl"), Type.Literal("credentials")]),
  loggedIn: Type.Optional(Type.Boolean()),
  plan: Type.Optional(Type.Object({ id: Type.String(), label: Type.String() })),
});
export type SessionState = Static<typeof SessionStateSchema>;
