// 責務: Proton のログインの単体テスト。入力の順序（資格情報の後に 2FA）、認証失敗と到達失敗の区別、プランの表示を確かめる（要件 2.1〜2.5）。

import { describe, expect, it } from "vitest";
import type { ApiClient, ApiResult } from "../../../common/api-client";
import type { PrepareIo } from "../prepare-types";
import { prepareProton } from "./proton";

/** 要求ごとの応答を返す偽の API（送った本文も記録する）。 */
function fakeApi(script: Record<string, ApiResult<unknown>>) {
  const bodies: Record<string, unknown> = {};
  const answer = (key: string, body?: unknown): ApiResult<unknown> => {
    bodies[key] = body;
    const result = script[key];
    if (result === undefined) throw new Error(`想定外の要求: ${key}`);
    return result;
  };
  const api: ApiClient = {
    get: async (path) => answer(`GET ${path}`) as never,
    post: async (path, body) => answer(`POST ${path}`, body) as never,
    put: async (path, body) => answer(`PUT ${path}`, body) as never,
    patch: async (path, body) => answer(`PATCH ${path}`, body) as never,
    delete: async (path) => answer(`DELETE ${path}`) as never,
  };
  return { api, bodies };
}

/** 入力の順序を記録する端末。answers の順に値を返す。 */
function scriptedIo(answers: string[]) {
  const asked: string[] = [];
  const printed: string[] = [];
  const io: PrepareIo = {
    hidden: async (label) => {
      asked.push(label);
      return answers.shift() ?? "";
    },
    visible: async () => "",
    print: (message) => printed.push(message),
  };
  return { io, asked, printed };
}

const ok = (body: unknown): ApiResult<unknown> => ({ ok: true, status: 200, body });

describe("prepareProton", () => {
  it("資格情報を入力し、2FA を直後に送ってログインし、プランを表示する", async () => {
    const { api, bodies } = fakeApi({
      "PUT /v1/providers/active": ok({}),
      "DELETE /v1/session": ok({}),
      "POST /v1/session": ok({ message: "ok" }),
      "GET /v1/session": ok({ loginMethod: "credentials", loggedIn: true, plan: { id: "free", label: "Free" } }),
    });
    const { io, asked, printed } = scriptedIo(["user@example.test", "pw", "123456"]);

    const outcome = await prepareProton(api, io);

    expect(outcome).toEqual({ ok: true, state: { vendor: "protonvpn", planId: "free" } });
    // 2FA は資格情報の後に、入力の直後に送る
    expect(asked).toHaveLength(3);
    expect(bodies["POST /v1/session"]).toEqual({ username: "user@example.test", password: "pw", twoFactorCode: "123456" });
    expect(printed.join("\n")).toContain("Free");
  });

  it("2FA を空で入力したら、2FA の項目を送らない", async () => {
    const { api, bodies } = fakeApi({
      "PUT /v1/providers/active": ok({}),
      "DELETE /v1/session": ok({}),
      "POST /v1/session": ok({ message: "ok" }),
      "GET /v1/session": ok({ loginMethod: "credentials", loggedIn: true, plan: { id: "paid", label: "Paid" } }),
    });
    const { io } = scriptedIo(["user", "pw", ""]);
    await prepareProton(api, io);
    expect(bodies["POST /v1/session"]).toEqual({ username: "user", password: "pw" });
  });

  it("認証の失敗は vendor-auth-failed（API の message のみ）で中止する", async () => {
    const { api } = fakeApi({
      "PUT /v1/providers/active": ok({}),
      "DELETE /v1/session": ok({}),
      "POST /v1/session": { ok: false, kind: "http", status: 401, error: "invalid_credentials", message: "認証に失敗しました" },
    });
    const { io } = scriptedIo(["user", "wrong", "000000"]);
    expect(await prepareProton(api, io)).toEqual({
      ok: false,
      reason: { kind: "vendor-auth-failed", message: "認証に失敗しました" },
    });
  });

  it("到達の失敗は vendor-unreachable で中止する（認証の失敗と区別する）", async () => {
    const { api } = fakeApi({
      "PUT /v1/providers/active": ok({}),
      "DELETE /v1/session": ok({}),
      "POST /v1/session": { ok: false, kind: "transport", message: "ECONNRESET" },
    });
    const { io } = scriptedIo(["user", "pw", "123456"]);
    expect(await prepareProton(api, io)).toEqual({ ok: false, reason: { kind: "vendor-unreachable" } });
  });
});
