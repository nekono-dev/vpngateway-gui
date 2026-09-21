// 責務: GET/PUT /v1/connection の統合テスト（プロキシ通信はモック）。接続先IDの解決（list-locationsの再実行・
// (Virtual)の除去）、接続先（ID・国）が接続操作で保存され以降のGET（＝Web UIのリロード後の取得）で返り、
// 切断・接続先変更で消えること、最後の接続先が切断後も残ることを検証する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "vpngwgui-test-"));
process.env.VPN_PROFILE_PATH = join(import.meta.dirname, "../../config/profiles/adguardvpn.json");
process.env.AUDIT_LOG_FILE = join(dir, "audit.log");
process.env.CONNECTION_STATE_FILE = join(dir, "connection-state.json");
process.env.LAST_LOCATION_FILE = join(dir, "last-location.json");
process.env.FAVORITE_LOCATIONS_FILE = join(dir, "favorite-locations.json");

const { executeVendorCommandMock } = vi.hoisted(() => ({ executeVendorCommandMock: vi.fn() }));
vi.mock("../proxy-client/proxy-client.js", () => ({ executeVendorCommand: executeVendorCommandMock }));

const { buildApp } = await import("../app.js");

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
const statusOutput = (city: string) => `Connected to \x1B[1m${city}\x1B[0m in \x1B[1mTUN\x1B[0m mode, running on \x1B[1mtun0\x1B[0m`;

const LIST_OUTPUT =
  "\x1B[1mISO   COUNTRY              CITY                           PING ESTIMATE\n\x1B[0m" +
  "JP    Japan                Tokyo                          4         \n" +
  "CN    China                Shanghai (Virtual)             59        \n" +
  "US    United States        Las Vegas                      111       \n";

// CLIの振る舞いを、実行されたサブコマンドごとに模擬する。`connect`は指定名（-lの値）を大文字化して接続した体で応答する。
let currentStatus = "VPN is disconnected";
const connectedNames: string[] = [];
function fakeCli({ resolvedArgv }: { resolvedArgv: string[] }) {
  if (resolvedArgv[0] === "list-locations") return Promise.resolve(ok(LIST_OUTPUT));
  if (resolvedArgv[0] === "connect") {
    const name = resolvedArgv[2];
    connectedNames.push(name);
    currentStatus = statusOutput(name.toUpperCase());
    return Promise.resolve(ok(`Successfully Connected to \x1B[1m${name.toUpperCase()}\x1B[0m\nYou are now connected.`));
  }
  if (resolvedArgv[0] === "disconnect") {
    currentStatus = "VPN is disconnected";
    return Promise.resolve(ok("VPN stopped"));
  }
  return Promise.resolve(ok(currentStatus));
}

const putConnection = (app: ReturnType<typeof buildApp>, payload: object) =>
  app.inject({ method: "PUT", url: "/v1/connection", payload });

describe("/v1/connection の接続先", () => {
  const app = buildApp();

  beforeEach(async () => {
    executeVendorCommandMock.mockReset();
    executeVendorCommandMock.mockImplementation(fakeCli);
    connectedNames.length = 0;
    currentStatus = "VPN is disconnected";
    rmSync(process.env.LAST_LOCATION_FILE!, { force: true });
    await app.inject({ method: "GET", url: "/v1/connection" }); // 切断観測で保存内容を初期化
  });

  it("接続後、PUTの応答とその後のGET（リロード後の取得相当）が要求した接続先ID・国を返す", async () => {
    const put = await putConnection(app, { connect: true, locationId: "jp-tokyo" });
    expect(put.json()).toEqual({ status: "connected", location: "TOKYO", country: "jp", locationId: "jp-tokyo" });

    const reloaded = await buildApp().inject({ method: "GET", url: "/v1/connection" });
    expect(reloaded.json()).toEqual({ status: "connected", location: "TOKYO", country: "jp", locationId: "jp-tokyo" });
  });

  it("(Virtual)付きの接続先は、(Virtual)を除いた指定名でCLIへ渡す（実機で(Virtual)付きは接続に失敗する）", async () => {
    const put = await putConnection(app, { connect: true, locationId: "cn-shanghai-virtual" });
    expect(put.statusCode).toBe(200);
    expect(connectedNames).toEqual(["Shanghai"]);
    expect(put.json()).toMatchObject({ country: "cn", locationId: "cn-shanghai-virtual" });
  });

  it("接続中に別の接続先IDで呼ぶと接続先を変更し、GETも新しい接続先を返す", async () => {
    await putConnection(app, { connect: true, locationId: "jp-tokyo" });
    const changed = await putConnection(app, { connect: true, locationId: "us-las-vegas" });
    expect(changed.json()).toMatchObject({ locationId: "us-las-vegas", country: "us", location: "LAS VEGAS" });

    const get = await app.inject({ method: "GET", url: "/v1/connection" });
    expect(get.json()).toMatchObject({ locationId: "us-las-vegas", country: "us" });
  });

  it("切断すると接続先は返らなくなるが、最後に接続した接続先は一覧に残る", async () => {
    await putConnection(app, { connect: true, locationId: "us-las-vegas" });
    const put = await putConnection(app, { connect: false });
    expect(put.json()).toEqual({ status: "disconnected" });

    const get = await app.inject({ method: "GET", url: "/v1/connection" });
    expect(get.json().locationId).toBeUndefined();

    const locations = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    const last = locations.json().filter((l: { lastConnected: boolean }) => l.lastConnected);
    expect(last.map((l: { id: string }) => l.id)).toEqual(["us-las-vegas"]);
  });

  it("CLI外で別の接続先へ再接続されていた場合は、古い接続先を返さない", async () => {
    await putConnection(app, { connect: true, locationId: "jp-tokyo" });
    currentStatus = statusOutput("BRUSSELS");
    const get = await app.inject({ method: "GET", url: "/v1/connection" });
    expect(get.json()).toEqual({ status: "connected", location: "BRUSSELS" });
  });

  it("一覧に存在しない接続先IDは400で、connectコマンドは実行しない", async () => {
    const put = await putConnection(app, { connect: true, locationId: "xx-atlantis" });
    expect(put.statusCode).toBe(400);
    expect(put.json()).toMatchObject({ error: "invalid_input" });
    expect(connectedNames).toEqual([]);
  });

  it("connect=trueでlocationIdが無い、または形式不正なら400", async () => {
    expect((await putConnection(app, { connect: true })).statusCode).toBe(400);
    expect((await putConnection(app, { connect: true, locationId: "--help" })).statusCode).toBe(400);
    expect((await putConnection(app, { connect: true, country: "jp" })).statusCode).toBe(400);
  });

  it("接続コマンドが失敗した場合（422）は接続先も最後の接続先も保存しない", async () => {
    executeVendorCommandMock.mockImplementation(({ resolvedArgv }: { resolvedArgv: string[] }) =>
      resolvedArgv[0] === "connect"
        ? Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom" })
        : fakeCli({ resolvedArgv }),
    );
    const put = await putConnection(app, { connect: true, locationId: "jp-tokyo" });
    expect(put.statusCode).toBe(422);

    const get = await app.inject({ method: "GET", url: "/v1/connection" });
    expect(get.json().locationId).toBeUndefined();
    const locations = await app.inject({ method: "GET", url: "/v1/connection/locations" });
    expect(locations.json().some((l: { lastConnected: boolean }) => l.lastConnected)).toBe(false);
  });

  it("list-locationsが失敗した場合、接続操作は422で、connectコマンドは実行しない", async () => {
    executeVendorCommandMock.mockResolvedValue({ exitCode: 11, stdout: "You are not logged in", stderr: "" });
    const put = await putConnection(app, { connect: true, locationId: "jp-tokyo" });
    expect(put.statusCode).toBe(422);
    expect(put.json()).toMatchObject({ stderr: "You are not logged in" });
    const executed = executeVendorCommandMock.mock.calls.map(([input]) => input.resolvedArgv[0]);
    expect(executed).not.toContain("connect");
  });
});
