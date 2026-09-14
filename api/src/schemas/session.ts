// 責務: ログイン代行（`POST /v1/session`）のレスポンスのTypeBoxスキーマ定義。

import { Type, type Static } from "@sinclair/typebox";

export const SessionResponseSchema = Type.Object({
  // ログインURL。`login`アクションのcompletionPatternに一致し、ブラウザでの認証待ちの間に返す場合のみ含まれる。
  // 既にログイン済みで即座に完了した場合は含まれない。
  loginUrl: Type.Optional(Type.String()),
  message: Type.String(),
});
export type SessionResponse = Static<typeof SessionResponseSchema>;
