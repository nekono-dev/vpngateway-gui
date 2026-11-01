// 責務: AdGuard の device 認証の単体テスト。承認の待ちと、5 分の上限での中止を、時刻と待機を差し替えて確かめる（要件 3.4）。

import { describe, expect, it } from "vitest";
import type { ApiClient, ApiResult } from "../../../common/api-client";
import type { PrepareIo } from "../prepare-types";
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS, prepareAdGuard } from "./adguard";

/** 要求の応答を順に返す偽の API（呼び出しの記録つき）。 */
function scriptedApi(responses: Record<string, ApiResult<unknown>[]>) {
  const calls: string[] = [];
  const next = (key: string): ApiResult<unknown> => {
    calls.push(key);
    const queue = responses[key];
    if (queue === undefined || queue.length === 0) throw new Error(`想定外の要求: ${key}`);
    return queue.length === 1 ? (queue[0] as ApiResult<unknown>) : (queue.shift() as ApiResult<unknown>);
  };
  const api: ApiClient = {
    get: async (path) => next(`GET ${path}`) as never,
    post: async (path) => next(`POST ${path}`) as never,
    put: async (path) => next(`PUT ${path}`) as never,
    patch: async (path) => next(`PATCH ${path}`) as never,
    delete: async (path) => next(`DELETE ${path}`) as never,
  };
  return { api, calls };
}

const io: PrepareIo = { hidden: async () => "", visible: async () => "", print: () => undefined };
const ok = (body: unknown): ApiResult<unknown> => ({ ok: true, status: 200, body });
const notYet = ok({ loggedIn: false });
const approved = ok({ loggedIn: true, plan: { id: "premium", label: "Premium" } });

describe("prepareAdGuard", () => {
  it("承認されるまで確認を繰り返し、承認後にプランを返す", async () => {
    const { api, calls } = scriptedApi({
      "PUT /v1/providers/active": [ok({})],
      "POST /v1/session": [ok({ loginUrl: "https://auth.adguard.io/device_code?user_code=ABCD-1234", message: "" })],
      "GET /v1/session": [notYet, notYet, approved],
    });
    let now = 0;
    const slept: number[] = [];
    const outcome = await prepareAdGuard(api, io, {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });
    expect(outcome).toEqual({ ok: true, state: { vendor: "adguardvpn", planId: "premium" } });
    expect(slept).toEqual([APPROVAL_POLL_MS, APPROVAL_POLL_MS]);
    expect(calls.filter((c) => c === "GET /v1/session")).toHaveLength(3);
  });

  it("5 分を過ぎても承認されなければ device-approval-timeout で中止する", async () => {
    const { api } = scriptedApi({
      "PUT /v1/providers/active": [ok({})],
      "POST /v1/session": [ok({ loginUrl: "https://auth.adguard.io/device_code?user_code=ABCD-1234", message: "" })],
      "GET /v1/session": [notYet],
    });
    let now = 0;
    const outcome = await prepareAdGuard(api, io, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(outcome).toEqual({ ok: false, reason: { kind: "device-approval-timeout" } });
    expect(now).toBeGreaterThanOrEqual(APPROVAL_TIMEOUT_MS);
  });
});
