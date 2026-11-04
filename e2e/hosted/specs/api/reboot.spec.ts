// 責務: 再起動の依頼（POST /v1/gateway/reboot）の試験（stack 群・api）。要件 10.1〜10.4。
// 依頼ファイルが残ったままホストの監視（vpngwgui-reboot.path）を再開すると、ホストが再起動する。
// そのため試験の前に監視を止め、依頼ファイルを消してから再開する。直列に実行する。

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { apiClient, loadAdmin } from "../../fixtures/stack";

const run = promisify(execFile);
const LOGIN = "/v1/operator/session";
const REBOOT = "/v1/gateway/reboot";
/** 依頼用ディレクトリ（installer/setup.sh の HOST_CTL_DIR と一致させる）。 */
const HOST_CTL_DIR = "/var/lib/vpngwgui-host-ctl";
const REQUEST_FILE = `${HOST_CTL_DIR}/reboot-request`;

/** 目的: 起動からの経過秒を返す（ホストが再起動すると小さくなる）。 */
function uptimeSeconds(): number {
  return Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
}

/** 目的: 依頼ファイルを消す（試験の状態をそろえる）。 */
async function clearRequest(): Promise<void> {
  await run("sudo", ["rm", "-f", REQUEST_FILE]);
}

/** 目的: 依頼ファイルが存在するかを確かめる。 */
async function requestExists(): Promise<boolean> {
  try {
    await run("sudo", ["test", "-e", REQUEST_FILE]);
    return true;
  } catch {
    return false;
  }
}

test.describe.serial("再起動の依頼（stack・api）", () => {
  let uptimeBefore = 0;

  test.beforeAll(async () => {
    // 監視を止めてから依頼ファイルを消す。これにより、試験の間はホストが再起動しない
    await run("sudo", ["systemctl", "stop", "vpngwgui-reboot.path"]);
    await clearRequest();
    await run("sudo", ["chmod", "0700", HOST_CTL_DIR]);
    uptimeBefore = uptimeSeconds();
  });

  test.afterAll(async () => {
    // 後始末: 書き込みの権限を戻し、依頼ファイルを消してから監視を再開する（順序を守る）
    await run("sudo", ["chmod", "0700", HOST_CTL_DIR]).catch(() => undefined);
    await clearRequest();
    await run("sudo", ["systemctl", "start", "vpngwgui-reboot.path"]);
    // 試験の間に再起動が起きていないことを、起動からの経過時間が減っていないことで確かめる
    expect(uptimeSeconds()).toBeGreaterThanOrEqual(uptimeBefore);
  });

  test("10.1・10.2: 再起動の依頼を 202 で受け付け、依頼ファイルが作られる", async () => {
    const admin = await loadAdmin();
    const client = apiClient();
    const login = await client.post(LOGIN, admin);
    expect(login.ok, "管理者のログインに失敗").toBe(true);

    const res = await client.post<{ requested: boolean }>(REBOOT, { password: admin.password });
    expect(res.ok && res.status).toBe(202);
    expect(await requestExists()).toBe(true);
  });

  test("10.3: 依頼が残っている間の 2 回目は 409 で拒否する", async () => {
    const admin = await loadAdmin();
    const client = apiClient();
    const login = await client.post(LOGIN, admin);
    expect(login.ok, "管理者のログインに失敗").toBe(true);

    const res = await client.post(REBOOT, { password: admin.password });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind === "http" ? res.status : 0).toBe(409);
    // 1 回目の依頼ファイルは残ったまま（2 回目が作り直していない）
    expect(await requestExists()).toBe(true);
    await clearRequest();
  });

  test("10.4: 依頼用ディレクトリに書き込めないと 503 を返す", async () => {
    const admin = await loadAdmin();
    const client = apiClient();
    const login = await client.post(LOGIN, admin);
    expect(login.ok, "管理者のログインに失敗").toBe(true);

    // 所有者（proxy の実行ユーザー）からも書き込めない権限にして、依頼を作れない状態を作る
    await run("sudo", ["chmod", "0500", HOST_CTL_DIR]);
    try {
      const res = await client.post(REBOOT, { password: admin.password });
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.kind === "http" ? res.status : 0).toBe(503);
      expect(await requestExists()).toBe(false);
    } finally {
      await run("sudo", ["chmod", "0700", HOST_CTL_DIR]);
    }
  });
});
