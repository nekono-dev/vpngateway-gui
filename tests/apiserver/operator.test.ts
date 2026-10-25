// 責務: 利用者アカウントの作成・変更・ログイン・認可・パスワードの保存・ログイン失敗の回数制限の受け入れテスト。
// 受け入れ条件 apiserver/AC-16・AC-17・AC-24・AC-25 を、認証なしのアプリケーションに対して確認する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCli } from "../helpers/fake-cli.js";
import { startApiHarness, type ApiHarness } from "../helpers/api-harness.js";

const cli = createFakeCli();
let harness: ApiHarness;
let stateDir = "";

beforeAll(async () => {
  harness = await startApiHarness({ handlers: { exec: cli.exec } });
});
afterAll(async () => {
  await harness.stop();
});
beforeEach(async () => {
  // アカウントの保存先を新しくし、ログイン失敗の記録も消す。
  stateDir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-operator-"));
  process.env.STATE_DIR = stateDir;
  process.env.AUDIT_LOG_FILE = join(stateDir, "audit.log");
  const { clearFailures } = await import("../../api/src/auth/login-rate-limiter.js");
  clearFailures("127.0.0.1");
});

const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object, cookie?: string) =>
  harness.rawApp.inject({ method, url, payload, headers: cookie === undefined ? {} : { cookie } });

/** 目的: Set-Cookieヘッダから、次の要求のCookieヘッダに使う `名前=値` を取り出す。 */
function cookieFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return value?.split(";")[0] ?? "";
}

describe("利用者の認証", () => {
  it("apiserver/AC-16: アカウントの作成前は初回作成だけが認証なしで使え、作成後は認証のないAPIが401になり、ログイン後に使える", async () => {
    expect((await call("GET", "/v1/operator")).json()).toEqual({ configured: false });
    // 作成前でも、状態確認・初回作成・ログイン以外のAPIは認証を要求する。
    expect((await call("GET", "/v1/connection")).statusCode).toBe(401);

    const created = await call("POST", "/v1/operator", { username: "admin", password: "correct-horse" });
    expect(created.statusCode).toBe(200);
    const setCookie = created.headers["set-cookie"] as string;
    expect(setCookie).toMatch(/vpngwgui_session=.+HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // Secure属性は、HTTPSで受けた接続にだけ付く（本番のAPIサーバは常にHTTPSで待ち受ける）。
    const { buildSessionCookie } = await import("../../api/src/auth/session-store.js");
    expect(buildSessionCookie("abc", true)).toContain("Secure");
    expect(buildSessionCookie("abc", false)).not.toContain("Secure");
    // 作成後の初回作成は、409で拒否される。
    expect((await call("POST", "/v1/operator", { username: "other", password: "another-pass" })).statusCode).toBe(409);
    // 認証なしの要求は401、状態確認は認証なしで使え、ユーザー名は含まれない。
    expect((await call("GET", "/v1/connection")).statusCode).toBe(401);
    expect((await call("GET", "/v1/connection")).json()).toMatchObject({ error: "unauthenticated" });
    expect((await call("GET", "/v1/operator")).json()).toEqual({ configured: true });

    // ログインするとセッションが発行され、APIが使える。誤った資格情報は401で、未作成と区別できない。
    expect((await call("POST", "/v1/operator/session", { username: "admin", password: "wrong" })).statusCode).toBe(401);
    const login = await call("POST", "/v1/operator/session", { username: "admin", password: "correct-horse" });
    expect(login.statusCode).toBe(200);
    const cookie = cookieFrom(login.headers["set-cookie"]);
    expect((await call("GET", "/v1/connection", undefined, cookie)).statusCode).toBe(200);
    expect((await call("GET", "/v1/operator", undefined, cookie)).json()).toEqual({ configured: true, username: "admin" });
    // ログアウトするとセッションが失効する。
    expect((await call("DELETE", "/v1/operator/session", undefined, cookie)).statusCode).toBe(200);
    expect((await call("GET", "/v1/connection", undefined, cookie)).statusCode).toBe(401);
  });

  it("apiserver/AC-17: ユーザー名とパスワードの変更は、現在のパスワードが一致するときだけ受理される", async () => {
    const created = await call("POST", "/v1/operator", { username: "admin", password: "correct-horse" });
    const cookie = cookieFrom(created.headers["set-cookie"]);
    // 現在のパスワードが誤りなら401、変更の指定が無ければ400。
    expect((await call("PUT", "/v1/operator", { currentPassword: "wrong", newPassword: "new-password-1" }, cookie)).statusCode).toBe(401);
    expect((await call("PUT", "/v1/operator", { currentPassword: "correct-horse" }, cookie)).statusCode).toBe(400);
    // 一致すれば受理され、現在のセッションは維持される。
    const changed = await call("PUT", "/v1/operator", { currentPassword: "correct-horse", username: "root", newPassword: "new-password-1" }, cookie);
    expect(changed.statusCode).toBe(200);
    expect((await call("GET", "/v1/connection", undefined, cookie)).statusCode).toBe(200);
    expect((await call("POST", "/v1/operator/session", { username: "root", password: "new-password-1" })).statusCode).toBe(200);
    expect((await call("POST", "/v1/operator/session", { username: "admin", password: "correct-horse" })).statusCode).toBe(401);
  });

  it("apiserver/AC-24: 保存されたアカウントにパスワードの平文が含まれず、ハッシュ方式が記録される", async () => {
    await call("POST", "/v1/operator", { username: "admin", password: "plaintext-must-not-be-stored" });
    const raw = readFileSync(join(stateDir, "operator-account.json"), "utf8");
    expect(raw).not.toContain("plaintext-must-not-be-stored");
    const stored = JSON.parse(raw) as Record<string, string>;
    expect(stored.algorithm).toBe("scrypt");
    expect(Object.keys(stored).sort()).toEqual(["algorithm", "hash", "salt", "username"]);
    expect(stored.hash.length).toBeGreaterThan(32);
  });

  it("apiserver/AC-25: ログインの失敗が5回を超えると、正しい資格情報でも429で拒否される", async () => {
    await call("POST", "/v1/operator", { username: "admin", password: "correct-horse" });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await call("POST", "/v1/operator/session", { username: "admin", password: `wrong-${attempt}` })).statusCode).toBe(401);
    }
    const limited = await call("POST", "/v1/operator/session", { username: "admin", password: "correct-horse" });
    expect(limited.statusCode).toBe(429);
  });
});
