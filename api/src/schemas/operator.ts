// 責務: Web UI利用者の単一管理者アカウント（`/v1/operator`）・ログイン状態（`/v1/operator/session`）の
// リクエスト/レスポンスのTypeBoxスキーマ定義。apiserver/design.md「Web UI利用者の認証」参照。
import { Type, type Static } from "@sinclair/typebox";

// パスワードの最小文字数（apiserver/design.md「Web UI利用者の認証」既定4文字以上）。
const PASSWORD_MIN_LENGTH = 4;

// `GET/POST/PUT /v1/operator`の応答。`username`は有効なセッションCookieがある場合のみ含める。
export const OperatorStateSchema = Type.Object({
  configured: Type.Boolean(),
  username: Type.Optional(Type.String()),
});
export type OperatorState = Static<typeof OperatorStateSchema>;

export const OperatorCreateBodySchema = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 256 }),
  password: Type.String({ minLength: PASSWORD_MIN_LENGTH, maxLength: 512 }),
});
export type OperatorCreateBody = Static<typeof OperatorCreateBodySchema>;

export const OperatorUpdateBodySchema = Type.Object({
  currentPassword: Type.String({ minLength: 1, maxLength: 512 }),
  username: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  newPassword: Type.Optional(Type.String({ minLength: PASSWORD_MIN_LENGTH, maxLength: 512 })),
});
export type OperatorUpdateBody = Static<typeof OperatorUpdateBodySchema>;

export const OperatorSessionLoginBodySchema = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 256 }),
  password: Type.String({ minLength: 1, maxLength: 512 }),
});
export type OperatorSessionLoginBody = Static<typeof OperatorSessionLoginBodySchema>;

// `POST/GET/DELETE /v1/operator/session`の応答。
export const OperatorSessionStateSchema = Type.Object({
  authenticated: Type.Boolean(),
});
export type OperatorSessionState = Static<typeof OperatorSessionStateSchema>;
