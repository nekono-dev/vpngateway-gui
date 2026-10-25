// 責務: 設定の動作検証（項目の導出・順次実行・排他・結果の保持）とゲートウェイ機の再起動の依頼の受け入れテスト。
// 受け入れ条件 apiserver/AC-18・AC-19・AC-27 を、ゲートウェイの代役の応答を使って確認する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createFakeCli } from "../helpers/fake-cli.js";
import { startApiHarness, type ApiHarness } from "../helpers/api-harness.js";

const cli = createFakeCli();
const TUNNEL_IP = "203.0.113.9";
let harness: ApiHarness;

beforeAll(async () => {
  harness = await startApiHarness({
    handlers: {
      exec: cli.exec,
      net: (method, path, body) => {
        if (method === "POST" && path === "/net/checks") {
          const check = String(body?.check);
          return { status: 200, json: { id: check, status: "pass", ...(check === "tunnel-egress" ? { value: TUNNEL_IP } : {}) } };
        }
        if (method === "POST" && path === "/net/check-nonces") return { status: 200, json: { registered: true } };
        return undefined;
      },
    },
  });
});
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => {
  harness.gateway.requests.length = 0;
});

const post = (url: string, payload?: object) => harness.app.inject({ method: "POST", url, payload });
const get = (url: string) => harness.app.inject({ method: "GET", url });
const putConfig = async (change: object) => {
  const current = (await get("/v1/connection/config")).json() as object;
  const response = await harness.app.inject({ method: "PUT", url: "/v1/connection/config", payload: { ...current, ...change } });
  expect(response.statusCode, response.body).toBe(200);
  return response;
};

interface Verification {
  id: string;
  state: "running" | "completed";
  checks: Array<{ id: string; status: string }>;
}

/** 目的: 検証が完了するまで取得を繰り返し、完了した結果を返す。 */
async function waitCompleted(id: string): Promise<Verification> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const verification = (await get(`/v1/verifications/${id}`)).json() as Verification;
    if (verification.state === "completed") return verification;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`verification did not complete: ${(await get(`/v1/verifications/${id}`)).body}`);
}

describe("設定の動作検証", () => {
  it("apiserver/AC-18: 動作検証は設定から導いた項目を順に実行し、同時に1件までで、結果を取得できる", async () => {
    await putConfig({ transparentGatewayEnabled: true, killSwitch: true, explicitProxyEnabled: false, dnsRelayEnabled: false });
    harness.gateway.requests.length = 0;
    const started = await post("/v1/verifications");
    expect(started.statusCode).toBe(202);
    const first = started.json() as Verification;
    // 設定で有効な機能の項目だけが対象になり、実行前は待機中または対象外である。
    expect(first.checks.map((check) => check.id)).toContain("gateway-rules");
    expect(first.checks.every((check) => ["pending", "running", "notApplicable"].includes(check.status))).toBe(true);
    expect(first.checks.find((check) => check.id === "dns-relay-listening")?.status).toBe("notApplicable");
    // 実行中の別の開始は409で拒否される。
    expect((await post("/v1/verifications")).statusCode).toBe(409);

    // ブラウザが取得した出口IPを提出する（トンネルの出口IPと同じ）。
    expect((await harness.app.inject({ method: "PUT", url: `/v1/verifications/${first.id}/client-observations/egress-ip`, payload: { ip: TUNNEL_IP } })).statusCode).toBe(200);
    const done = await waitCompleted(first.id);
    const results = Object.fromEntries(done.checks.map((check) => [check.id, check.status]));
    expect(results).toMatchObject({ "gateway-rules": "pass", "kill-switch-rules": "pass", "tunnel-egress": "pass", "client-egress": "pass", "dns-relay-listening": "notApplicable" });
    // ゲートウェイの項目は1件ずつ、定められた順に依頼される。
    const requested = harness.gateway.requests.filter((request) => request.path === "/net/checks").map((request) => request.body?.check);
    expect(requested).toEqual(["gateway-rules", "kill-switch-rules", "tunnel-egress"]);
    // 完了後は、新しい検証を開始できる。
    const next = await post("/v1/verifications");
    expect(next.statusCode).toBe(202);
    await harness.app.inject({ method: "PUT", url: `/v1/verifications/${(next.json() as Verification).id}/client-observations/egress-ip`, payload: { ip: null } });
    await waitCompleted((next.json() as Verification).id);
  }, 30000);

  it("apiserver/AC-27: 動作検証の結果は直近5件だけが取得でき、保存先に検証結果のファイルが作られない", async () => {
    // 端末の項目を含まない設定（明示的プロキシだけ）にして、検証を短く完了させる。
    await putConfig({
      transparentGatewayEnabled: false,
      explicitProxyEnabled: true,
      explicitProxyAllowedCidrs: ["192.168.3.0/24"],
      dnsRelayEnabled: false,
    });
    const ids: string[] = [];
    for (let run = 0; run < 6; run += 1) {
      const started = await post("/v1/verifications");
      expect(started.statusCode).toBe(202);
      const id = (started.json() as Verification).id;
      ids.push(id);
      await waitCompleted(id);
    }
    expect((await get(`/v1/verifications/${ids[0]}`)).statusCode).toBe(404);
    for (const id of ids.slice(-5)) expect((await get(`/v1/verifications/${id}`)).statusCode, id).toBe(200);
    // 状態の保存先に、検証の結果を示すファイルが無い。監査ログには件数だけが残る。
    const stateDir = process.env.STATE_DIR as string;
    expect(readdirSync(stateDir, { recursive: true }).map(String).filter((name) => /verif/i.test(name))).toEqual([]);
    expect(existsSync(harness.auditLogFile)).toBe(true);
    expect(readFileSync(harness.auditLogFile, "utf8")).not.toContain(TUNNEL_IP);
  }, 40000);
});

describe("ゲートウェイ機の再起動", () => {
  it("apiserver/AC-19: 再起動の依頼は、パスワードが正しいときだけゲートウェイへ伝わり、誤ると401で伝わらない", async () => {
    const rebootRequests = () => harness.gateway.requests.filter((request) => request.path === "/net/host-reboot");
    const wrong = await post("/v1/gateway/reboot", { password: "wrong-password" });
    expect(wrong.statusCode).toBe(401);
    expect(rebootRequests()).toHaveLength(0);
    const accepted = await post("/v1/gateway/reboot", { password: "test-password-1234" });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ requested: true });
    expect(rebootRequests()).toHaveLength(1);
    // 監査ログには依頼の結果が残り、パスワードは残らない。
    const log = readFileSync(harness.auditLogFile, "utf8");
    expect(log).toContain("gateway_reboot");
    expect(log).not.toContain("test-password-1234");
    expect(log).not.toContain("wrong-password");
  });
});
