// 責務: POST/GET/DELETE /v1/operator/session（Web UI利用者のログイン状態）の統合テスト。
// あわせて、requireOperatorSessionのpreHandlerによる他の/v1/*ルートの認可も検証する。

import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.VENDORS_DIR = join(import.meta.dirname, "../../../vendors");
process.env.ENABLED_PROVIDERS = "adguardvpn";

const { buildApp } = await import("../app.js");
const { clearFailures } = await import("../auth/login-rate-limiter.js");

// operator.test.tsと同様、アカウントはファイル永続化のためテストごとにSTATE_DIRを切り替える。
// レート制限（login-rate-limiter.ts）はSTATE_DIRに関係なくプロセスメモリ・送信元IP単位で数えており、
// app.injectの送信元IPは既定で常に127.0.0.1になるため、テストをまたいで失敗回数が積み上がってしまう。
// 各テストを自己完結させるため、テストごとにこのIPの記録をクリアする。
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
  process.env.STATE_DIR = dir;
  process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
  clearFailures("127.0.0.1");
});

function cookieHeaderFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return value?.split(";")[0] ?? "";
}

async function createAccount(app: ReturnType<typeof buildApp>, username = "admin", password = "correct-password") {
  await app.inject({ method: "POST", url: "/v1/operator", payload: { username, password } });
}

describe("POST /v1/operator/session", () => {
  it("正しいユーザー名・パスワードでログインでき、Set-Cookieを返す", async () => {
    const app = buildApp();
    await createAccount(app);
    const response = await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "admin", password: "correct-password" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: true });
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("誤ったパスワードは401（アカウント未作成と同じ応答形状で、作成有無を区別させない）", async () => {
    const app = buildApp();
    await createAccount(app);
    const response = await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "admin", password: "wrong-password" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("アカウント未作成の状態でのログイン試行も同じ401", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "nobody", password: "whatever1" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("直近1分間に5回失敗すると429になる", async () => {
    const app = buildApp();
    await createAccount(app);
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "admin", password: "wrong-password" } });
    }
    const response = await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "admin", password: "correct-password" } });
    expect(response.statusCode).toBe(429);
  });
});

describe("GET /v1/operator/session", () => {
  it("有効なセッションCookieがあれば200 authenticated=true", async () => {
    const app = buildApp();
    await createAccount(app);
    const login = await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "admin", password: "correct-password" } });
    const cookie = cookieHeaderFrom(login.headers["set-cookie"]);
    const response = await app.inject({ method: "GET", url: "/v1/operator/session", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: true });
  });

  it("Cookie無しは401", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/operator/session" });
    expect(response.statusCode).toBe(401);
  });
});

describe("DELETE /v1/operator/session", () => {
  it("ログアウト後は同じCookieで認証済みルートを呼べなくなる", async () => {
    const app = buildApp();
    await createAccount(app);
    const login = await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "admin", password: "correct-password" } });
    const cookie = cookieHeaderFrom(login.headers["set-cookie"]);

    const logout = await app.inject({ method: "DELETE", url: "/v1/operator/session", headers: { cookie } });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ authenticated: false });

    const after = await app.inject({ method: "GET", url: "/v1/operator/session", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});

describe("requireOperatorSessionのpreHandler（他の/v1/*ルートへの適用）", () => {
  it("セッションCookie無しで/v1/providers等を呼ぶと401", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/providers" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("有効なセッションCookieがあれば/v1/providers等を呼べる", async () => {
    const app = buildApp();
    await createAccount(app);
    const login = await app.inject({ method: "POST", url: "/v1/operator/session", payload: { username: "admin", password: "correct-password" } });
    const cookie = cookieHeaderFrom(login.headers["set-cookie"]);
    const response = await app.inject({ method: "GET", url: "/v1/providers", headers: { cookie } });
    expect(response.statusCode).toBe(200);
  });
});
