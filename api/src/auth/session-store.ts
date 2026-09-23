// 責務: Web UIログインセッションの保持（プロセスメモリ。APIコンテナ再起動でリセットされる）と、
// セッションCookie（`vpngwgui_session`）の解析・組み立て。apiserver/design.md「Web UI利用者の認証」参照。

import { randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "vpngwgui_session";

interface SessionRecord {
  createdAt: number;
}

const sessions = new Map<string, SessionRecord>();

/**
 * 目的: 新しいログインセッションを作成する。
 * 出力: 発行したsessionId（256bitのランダム値、16進文字列）。
 * 副作用: sessionsへ追加する。
 */
export function createSession(): string {
  const sessionId = randomBytes(32).toString("hex");
  sessions.set(sessionId, { createdAt: Date.now() });
  return sessionId;
}

/**
 * 目的: sessionIdが有効なセッションを指すかを判定する。
 * 入力: sessionId(Cookieから取り出した値。未指定を許す)。
 * 出力: 有効ならtrue。
 */
export function isValidSession(sessionId: string | undefined): boolean {
  return sessionId !== undefined && sessions.has(sessionId);
}

/**
 * 目的: セッションを破棄する（ログアウト）。
 * 入力: sessionId(未指定・存在しない値も許す。その場合は何もしない)。
 * 副作用: sessionsから削除する。
 */
export function deleteSession(sessionId: string | undefined): void {
  if (sessionId !== undefined) {
    sessions.delete(sessionId);
  }
}

/**
 * 目的: `Cookie`リクエストヘッダから、セッションCookieの値を取り出す。
 * 入力: cookieHeader(Fastifyの`request.headers.cookie`。複数Cookieを`; `区切りで含む)。
 * 出力: 見つかればその値、無ければundefined。
 */
export function readSessionIdFromCookieHeader(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      return part.slice(separatorIndex + 1).trim();
    }
  }
  return undefined;
}

/**
 * 目的: ログイン成功時に返す`Set-Cookie`ヘッダ値を組み立てる。
 * 入力: sessionId, secure(HTTPS接続時のみtrue。`Secure`属性はHTTPS接続でのみ付与する。
 *       Phase25の段階1・2はTLS化前のためHTTP環境での検証を要するが、`Secure`を常時付けると
 *       ブラウザがCookieを送り返さず検証不能になるため、接続方式に応じて出し分ける）。
 * 出力: Set-Cookieヘッダ値。
 */
export function buildSessionCookie(sessionId: string, secure: boolean): string {
  const attributes = ["HttpOnly", "SameSite=Lax", "Path=/"];
  if (secure) {
    attributes.unshift("Secure");
  }
  return [`${SESSION_COOKIE_NAME}=${sessionId}`, ...attributes].join("; ");
}

/**
 * 目的: ログアウト時に返す、セッションCookieを失効させる`Set-Cookie`ヘッダ値を組み立てる。
 * 出力: Set-Cookieヘッダ値（Max-Age=0）。
 */
export function buildExpiredSessionCookie(secure: boolean): string {
  const attributes = ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) {
    attributes.unshift("Secure");
  }
  return [`${SESSION_COOKIE_NAME}=`, ...attributes].join("; ");
}
