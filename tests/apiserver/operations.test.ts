// 責務: APIサーバの操作（コマンドの解決と送信・入力の再検証・接続先・お気に入り・接続状態・起動時の復元）の受け入れテスト。
// 受け入れ条件 apiserver/AC-1〜AC-3・AC-10〜AC-13 を、相互TLSのゲートウェイの代役とCLIの代役を使って確認する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCli } from "../helpers/fake-cli.js";
import { startApiHarness, type ApiHarness } from "../helpers/api-harness.js";

const cli = createFakeCli();
let harness: ApiHarness;

/** 目的: テストごとに状態の保存先を新しくする（ベンダー別の状態・設定を持ち越さない）。 */
function resetState(): void {
  const dir = mkdtempSync(join(tmpdir(), "vpngwgui-accept-api-state-"));
  process.env.STATE_DIR = dir;
  process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
  process.env.SETTINGS_FILE = join(dir, "settings.json");
}

beforeAll(async () => {
  harness = await startApiHarness({ handlers: { exec: cli.exec } });
});
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => {
  resetState();
  cli.state.connected = undefined;
  cli.state.loggedIn = true;
  cli.state.executed.length = 0;
  harness.gateway.requests.length = 0;
});

const put = (url: string, payload?: object) => harness.app.inject({ method: "PUT", url, payload });
const get = (url: string) => harness.app.inject({ method: "GET", url });

/** 目的: ゲートウェイの代役が受け取った、CLIの実行要求（サブコマンドと引数）を返す。 */
function executedArgv(vendor: string): string[][] {
  return cli.state.executed.filter((entry) => entry.vendor === vendor).map((entry) => entry.body.resolvedArgv as string[]);
}

describe("操作の解決と送信", () => {
  it("apiserver/AC-1: 接続の操作は、プロファイルのコマンドを引数配列に解決し、選択中のベンダーのランナーへ送る", async () => {
    const response = await put("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    expect(response.statusCode).toBe(200);
    const connect = cli.state.executed.find((entry) => (entry.body.resolvedArgv as string[])[0] === "connect");
    expect(connect?.vendor).toBe("adguardvpn");
    expect(connect?.body).toMatchObject({
      vendor: "adguardvpn",
      binary: "/usr/local/bin/adguardvpn-cli",
      resolvedArgv: ["connect", "-l", "Tokyo", "-y"],
      timeoutMs: 30000,
    });
    // 選択中でないベンダーのランナーへは、何も送らない。
    expect(harness.gateway.requests.some((request) => request.path.startsWith("/runners/protonvpn"))).toBe(false);
    // 接続後に、ゲートウェイへ接続状態の再確認を通知する。
    expect(harness.gateway.requests.some((request) => request.path === "/net/connection-checks")).toBe(true);
  });

  it("apiserver/AC-2: シェルのメタ文字を含むユーザー名は、分割も解釈もされず1つの引数として送られる", async () => {
    const switched = await put("/v1/providers/active", { providerId: "protonvpn" });
    expect(switched.statusCode).toBe(200);
    cli.state.executed.length = 0;
    const username = "a;touch /tmp/x|$(id)`id`";
    const login = await harness.app.inject({ method: "POST", url: "/v1/session", payload: { username: username.replaceAll(" ", ""), password: "pw-1234" } });
    expect(login.statusCode).toBe(200);
    const signin = cli.state.executed.find((entry) => (entry.body.resolvedArgv as string[])[0] === "signin");
    expect(signin?.body.resolvedArgv).toEqual(["signin", "--totp", "a;touch/tmp/x|$(id)`id`"]);
    // 空白を含むユーザー名は、パターンに反するため400で拒否される。
    expect((await harness.app.inject({ method: "POST", url: "/v1/session", payload: { username: "a b", password: "pw-1234" } })).statusCode).toBe(400);
    await put("/v1/providers/active", { providerId: "adguardvpn" });
  });

  it("apiserver/AC-3: 一覧に存在しない接続先と不正な本文は400で拒否され、接続のコマンドはゲートウェイへ送られない", async () => {
    for (const payload of [{ connect: true, locationId: "zz-nowhere" }, { connect: true }, { connect: "yes" }, { locationId: "jp-tokyo" }]) {
      const response = await put("/v1/connection", payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(executedArgv("adguardvpn").some((argv) => argv[0] === "connect")).toBe(false);
  });
});

describe("接続先と接続状態", () => {
  it("apiserver/AC-10: 接続先の一覧は応答時間の昇順で、お気に入りと最後の接続先の別を含む", async () => {
    await put("/v1/connection/locations/cn-shanghai-virtual/favorite");
    await put("/v1/connection", { connect: true, locationId: "us-las-vegas" });
    const response = await get("/v1/connection/locations");
    const locations = response.json() as Array<{ id: string; pingMs?: number; favorite: boolean; lastConnected: boolean }>;
    expect(locations.map((location) => location.id)).toEqual(["jp-tokyo", "cn-shanghai-virtual", "us-las-vegas"]);
    expect(locations.map((location) => location.pingMs)).toEqual([4, 59, 111]);
    expect(locations.filter((location) => location.favorite).map((location) => location.id)).toEqual(["cn-shanghai-virtual"]);
    expect(locations.filter((location) => location.lastConnected).map((location) => location.id)).toEqual(["us-las-vegas"]);
  });

  it("apiserver/AC-11: お気に入りの登録と解除は何度行っても結果が同じで、保存され、不正なIDは400になる", async () => {
    const path = "/v1/connection/locations/jp-tokyo/favorite";
    expect((await put(path)).statusCode).toBe(200);
    expect((await put(path)).statusCode).toBe(200);
    const favoritesOf = async () => ((await get("/v1/connection/locations")).json() as Array<{ id: string; favorite: boolean }>).filter((l) => l.favorite).map((l) => l.id);
    expect(await favoritesOf()).toEqual(["jp-tokyo"]);
    const remove = () => harness.app.inject({ method: "DELETE", url: path });
    expect((await remove()).statusCode).toBe(200);
    expect((await remove()).statusCode).toBe(200);
    expect(await favoritesOf()).toEqual([]);
    expect((await put("/v1/connection/locations/BAD_ID/favorite")).statusCode).toBe(400);
  });

  it("apiserver/AC-12: 接続後の状態は接続先と国を返し、切断で消え、最後の接続先は切断後も残る", async () => {
    await put("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    expect((await get("/v1/connection")).json()).toEqual({ status: "connected", location: "TOKYO", country: "jp", locationId: "jp-tokyo" });
    await put("/v1/connection", { connect: false });
    expect((await get("/v1/connection")).json()).toEqual({ status: "disconnected" });
    const locations = (await get("/v1/connection/locations")).json() as Array<{ id: string; lastConnected: boolean }>;
    expect(locations.find((location) => location.lastConnected)?.id).toBe("jp-tokyo");
    // APIの外で別の接続先へ再接続された場合は、保存済みの国を返さない。
    await put("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    cli.state.connected = "LAS VEGAS";
    expect((await get("/v1/connection")).json()).toEqual({ status: "connected", location: "LAS VEGAS" });
  });

  it("apiserver/AC-13: 直前が接続中だった場合の起動時の復元は同じ接続先へ接続し、切断中だった場合は何もしない", async () => {
    const { restoreConnectionOnStartup } = await import("../../api/src/connection-state/restore-connection.js");
    const logger = { info: () => undefined, warn: () => undefined };
    const restoreConnection = () => restoreConnectionOnStartup(logger);
    // 切断中（保存済みの接続情報なし）: 何も実行しない。
    await restoreConnection();
    expect(executedArgv("adguardvpn").some((argv) => argv[0] === "connect")).toBe(false);
    // 接続中だった（保存済み）が、CLIの接続は失われた: 同じ接続先へ接続する。
    await put("/v1/connection", { connect: true, locationId: "jp-tokyo" });
    cli.state.connected = undefined;
    cli.state.executed.length = 0;
    await restoreConnection();
    expect(executedArgv("adguardvpn").find((argv) => argv[0] === "connect")).toEqual(["connect", "-l", "Tokyo", "-y"]);
    // 既に接続中なら、再接続しない。
    cli.state.executed.length = 0;
    await restoreConnection();
    expect(executedArgv("adguardvpn").some((argv) => argv[0] === "connect")).toBe(false);
  });
});
