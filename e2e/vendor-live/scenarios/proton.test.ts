// 責務: 接続・切断・プラン制限の判定の単体テスト（要件 4.2〜4.8）。偽の API で、実機の応答を模す。

import { describe, expect, it } from "vitest";
import { fakeApi, httpError, ok, type FakeHandler } from "./fake-api";
import { adguardCases } from "./adguard";
import { judgeConnected, judgeDisconnected } from "./connection";
import { protonCases, RESTRICTED_PROBE_LOCATION_ID } from "./proton";
import type { EgressObservation } from "../lib/egress";
import type { Verdict } from "./run";

const BASELINE = "203.0.113.7";

/** 検証（POST /v1/verifications）の応答。tunnel-egress の項目だけを持つ。 */
function verification(check: { status: string; observed?: string; reason?: string }) {
  return ok({ id: "v1", state: "completed", checks: [{ id: "tunnel-egress", ...check }] });
}

/** 観測の要求（POST /v1/verifications と GET /v1/verifications/:id）に答える。 */
function egressReply(check: { status: string; observed?: string; reason?: string }): FakeHandler {
  return (method, path) => (method === "POST" && path === "/v1/verifications" ? verification(check) : httpError(404, "not_found"));
}

/** 判定の結果の合否だけを取り出す。 */
function outcomeOf(verdict: Verdict): boolean {
  return verdict.ok;
}

describe("接続後と切断後の判定", () => {
  it("接続後の観測が基準と異なる IP なら合格、同じ IP なら VPN を通っていないとして失敗", () => {
    const other: EgressObservation = { kind: "observed", ip: "192.168.50.200" };
    const same: EgressObservation = { kind: "observed", ip: BASELINE };
    expect(outcomeOf(judgeConnected(other, BASELINE))).toBe(true);
    const verdict = judgeConnected(same, BASELINE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.observed).toContain("VPN を通っていない");
  });

  it("接続後に観測できなければ失敗", () => {
    expect(outcomeOf(judgeConnected({ kind: "unconfirmed", reason: "切断中" }, BASELINE))).toBe(false);
  });

  it("切断後は未確認なら合格、IP が観測されれば失敗", () => {
    expect(outcomeOf(judgeDisconnected({ kind: "unconfirmed", reason: "切断中" }))).toBe(true);
    expect(outcomeOf(judgeDisconnected({ kind: "observed", ip: "192.168.50.200" }))).toBe(false);
  });
});

describe("protonCases", () => {
  it("試験を、接続 → プラン制限 → 切断 → 切断後の確認 → 終了時の切断の順に組み立てる", () => {
    const cases = protonCases({ api: fakeApi(() => ok({})), baselineIp: BASELINE, planId: "free" });
    expect(cases.map((item) => item.requirement)).toEqual(["4.2", "4.5", "4.3", "4.8"]);
    expect(cases[0].name).toBe("proton/接続後の出口 IP が基準と異なる");
  });

  it("無料プランは、接続先を指定した接続が 403（operation_restricted）なら合格", async () => {
    const seen: unknown[] = [];
    const api = fakeApi((method, path, body) => {
      seen.push([method, path, body]);
      return httpError(403, "operation_restricted", "無料");
    });
    const [, plan] = protonCases({ api, baselineIp: BASELINE, planId: "free" });
    const verdict = await plan.run();
    expect(verdict.ok).toBe(true);
    expect(seen).toEqual([["PUT", "/v1/connection", { connect: true, locationId: RESTRICTED_PROBE_LOCATION_ID }]]);
  });

  it("無料プランで接続先を指定した接続が成功してしまえば失敗", async () => {
    const api = fakeApi(() => ok({ status: "connected" }));
    const [, plan] = protonCases({ api, baselineIp: BASELINE, planId: "free" });
    const verdict = await plan.run();
    expect(verdict.ok).toBe(false);
  });

  it("有料プランは、一覧の先頭の接続先へ接続できれば合格", async () => {
    const api = fakeApi((method, path) => {
      if (method === "GET" && path === "/v1/connection/locations") return ok([{ id: "jp-tyo" }]);
      if (method === "PUT" && path === "/v1/connection") return ok({ status: "connected" });
      return httpError(404, "not_found");
    });
    const [, plan] = protonCases({ api, baselineIp: BASELINE, planId: "paid" });
    const verdict = await plan.run();
    expect(verdict).toMatchObject({ ok: true, observed: "接続先 jp-tyo へ接続した" });
  });

  it("有料プランで指定した接続先への接続が 403 なら失敗", async () => {
    const api = fakeApi((method, path) => {
      if (method === "GET" && path === "/v1/connection/locations") return ok([{ id: "jp-tyo" }]);
      return httpError(403, "operation_restricted", "制限");
    });
    const [, plan] = protonCases({ api, baselineIp: BASELINE, planId: "paid" });
    const verdict = await plan.run();
    expect(verdict.ok).toBe(false);
  });

  it("プランを判定できなければ失敗", async () => {
    const [, plan] = protonCases({ api: fakeApi(() => ok({})), baselineIp: BASELINE, planId: "unknown" });
    const verdict = await plan.run();
    expect(verdict).toMatchObject({ ok: false, expected: "無料または有料のプラン" });
  });
});

describe("終了時の切断（4.8）", () => {
  it("接続が残っていれば切断してから、切断済みを確かめて合格する", async () => {
    let status = "connected";
    const seen: string[] = [];
    const api = fakeApi((method, path) => {
      seen.push(`${method} ${path}`);
      if (method === "GET" && path === "/v1/connection") return ok({ status });
      if (method === "PUT" && path === "/v1/connection") {
        status = "disconnected";
        return ok({ status });
      }
      return httpError(404, "not_found");
    });
    const cases = protonCases({ api, baselineIp: BASELINE, planId: "free" });
    const verdict = await cases[3].run();
    expect(verdict.ok).toBe(true);
    expect(seen).toEqual(["GET /v1/connection", "PUT /v1/connection", "GET /v1/connection"]);
  });

  it("切断の要求が失敗すれば、失敗として記録する", async () => {
    const api = fakeApi((method, path) => {
      if (method === "GET" && path === "/v1/connection") return ok({ status: "connected" });
      return httpError(422, "disconnect_failed", "切断できない");
    });
    const cases = protonCases({ api, baselineIp: BASELINE, planId: "free" });
    const verdict = await cases[3].run();
    expect(verdict.ok).toBe(false);
  });
});

describe("adguardCases", () => {
  it("接続先を一覧の先頭から選んで接続し、観測・切断・終了時の切断の順で組み立てる", async () => {
    const seen: unknown[] = [];
    const api = fakeApi((method, path, body) => {
      seen.push([method, path, body]);
      if (method === "GET" && path === "/v1/connection/locations") return ok([{ id: "us-las-vegas" }]);
      if (method === "PUT" && path === "/v1/connection") return ok({ status: "connected" });
      return egressReply({ status: "pass", observed: "192.168.50.200" })(method, path, body);
    });
    const cases = adguardCases({ api, baselineIp: BASELINE });
    expect(cases.map((item) => item.requirement)).toEqual(["4.2", "4.3", "4.8"]);

    const verdict = await cases[0].run();
    expect(verdict.ok).toBe(true);
    expect(seen).toContainEqual(["PUT", "/v1/connection", { connect: true, locationId: "us-las-vegas" }]);
  });

  it("接続先の一覧が空なら、接続せずに失敗する", async () => {
    const api = fakeApi((method, path) => {
      if (method === "GET" && path === "/v1/connection/locations") return ok([]);
      return httpError(404, "not_found");
    });
    const cases = adguardCases({ api, baselineIp: BASELINE });
    const verdict = await cases[0].run();
    expect(verdict).toMatchObject({ ok: false, observed: "接続先の一覧が空" });
  });
});
