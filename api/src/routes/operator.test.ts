// 責務: GET/POST/PUT /v1/operator（単一管理者アカウントの状態確認・初回作成・変更）の統合テスト。

import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";

const { buildApp } = await import("../app.js");
const { clearFailures } = await import("../auth/login-rate-limiter.js");

// アカウントはファイル永続化（operator-account-store.ts）のため、buildApp()を呼び直すだけでは
// リセットされない。テストごとにSTATE_DIRを新しい一時ディレクトリへ切り替え、他のテストで作成した
// アカウントの影響を受けないようにする。レート制限（PUT /v1/operator）はSTATE_DIRに関係なく
// プロセスメモリ・送信元IP単位（app.injectは既定で127.0.0.1）のため、あわせてクリアする。
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
  process.env.STATE_DIR = dir;
  process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
  clearFailures("127.0.0.1");
});

/** Set-Cookieヘッダから`name=value`部分だけを取り出す（次のリクエストのCookieヘッダにそのまま使う）。 */
function cookieHeaderFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return value?.split(";")[0] ?? "";
}

describe("GET /v1/operator", () => {
  it("未作成の状態ではconfigured=falseを認証無しで返す", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/operator" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: false });
  });
});

describe("POST /v1/operator", () => {
  it("初回作成に成功し、そのままログイン状態になる（Set-Cookieを返す）", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/operator",
      payload: { username: "admin", password: "correct-password" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: true, username: "admin" });
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("作成後にGET /v1/operatorを認証無しで呼ぶと、usernameを含めずconfigured=trueを返す", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/v1/operator", payload: { username: "admin", password: "correct-password" } });
    const response = await app.inject({ method: "GET", url: "/v1/operator" });
    expect(response.json()).toEqual({ configured: true });
  });

  it("作成後にGET /v1/operatorをログイン済みCookie付きで呼ぶと、usernameを含める", async () => {
    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/operator",
      payload: { username: "admin", password: "correct-password" },
    });
    const cookie = cookieHeaderFrom(created.headers["set-cookie"]);
    const response = await app.inject({ method: "GET", url: "/v1/operator", headers: { cookie } });
    expect(response.json()).toEqual({ configured: true, username: "admin" });
  });

  it("作成済みの状態で再度POST /v1/operatorを呼ぶと409", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/v1/operator", payload: { username: "admin", password: "correct-password" } });
    const response = await app.inject({
      method: "POST",
      url: "/v1/operator",
      payload: { username: "other", password: "another-password" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "already_configured" });
  });

  it("パスワードが最小文字数未満なら400", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/operator", payload: { username: "admin", password: "abc" } });
    expect(response.statusCode).toBe(400);
  });
});

describe("PUT /v1/operator", () => {
  async function setUpLoggedInApp() {
    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/operator",
      payload: { username: "admin", password: "correct-password" },
    });
    const cookie = cookieHeaderFrom(created.headers["set-cookie"]);
    return { app, cookie };
  }

  it("セッションCookie無しで呼ぶと401（未認証のため、現在パスワードの検証にも進まない）", async () => {
    const { app } = await setUpLoggedInApp();
    const response = await app.inject({ method: "PUT", url: "/v1/operator", payload: { currentPassword: "correct-password", newPassword: "new-password-1" } });
    expect(response.statusCode).toBe(401);
  });

  it("現在パスワードが誤っていれば401", async () => {
    const { app, cookie } = await setUpLoggedInApp();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/operator",
      headers: { cookie },
      payload: { currentPassword: "wrong-password", newPassword: "new-password-1" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("username・newPasswordのいずれも指定しなければ400", async () => {
    const { app, cookie } = await setUpLoggedInApp();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/operator",
      headers: { cookie },
      payload: { currentPassword: "correct-password" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("正しい現在パスワードでパスワードを変更でき、現在のセッションは維持される（再ログイン不要）", async () => {
    const { app, cookie } = await setUpLoggedInApp();
    const updated = await app.inject({
      method: "PUT",
      url: "/v1/operator",
      headers: { cookie },
      payload: { currentPassword: "correct-password", newPassword: "new-password-1" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ configured: true, username: "admin" });

    // 変更直後も、同じCookieのまま（強制再ログインされず）認証済みルートを呼べる。
    const sessionCheck = await app.inject({ method: "GET", url: "/v1/operator/session", headers: { cookie } });
    expect(sessionCheck.statusCode).toBe(200);

    // 新しいパスワードでログインできる。
    const login = await app.inject({
      method: "POST",
      url: "/v1/operator/session",
      payload: { username: "admin", password: "new-password-1" },
    });
    expect(login.statusCode).toBe(200);
  });
});
