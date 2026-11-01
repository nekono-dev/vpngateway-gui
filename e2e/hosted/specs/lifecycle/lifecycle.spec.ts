// 責務: 導入・更新・削除の試験（lifecycle 群）。導入は試験自身が行う（要件 9.1〜9.6）。
// 順序が必要なので直列に実行する。途中で失敗しても、最後に導入の残りを消す（後始末）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { exists, installer, shell, INSTALLER } from "../../fixtures/installer";

const run = promisify(execFile);
const CONF = "/etc/vpngwgui";
const DATA = "/var/lib/vpngwgui";
const SRC = "/opt/vpngwgui";

/** 目的: 既定経路の回線の名前（導入の LAN_IFACE に使う。この時点では経路は変えない）。 */
async function defaultIface(): Promise<string> {
  const { stdout } = await run("sh", ["-c", "ip -4 route show default | awk '{for(i=1;i<NF;i++) if($i==\"dev\"){print $(i+1); exit}}'"], { encoding: "utf8" });
  return stdout.trim();
}

/** 目的: 現在の HEAD と、その 1 つ前のコミット（更新の試験で使う）。 */
async function commits(): Promise<{ head: string; previous: string }> {
  const head = (await run("git", ["rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
  const previous = (await run("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" })).stdout.trim();
  return { head, previous };
}

/** 目的: 存在しないことを確かめるため、nftables の規則表が無ければ true。 */
async function nftTableAbsent(): Promise<boolean> {
  try {
    await run("sudo", ["nft", "list", "table", "inet", "vpngwgui"]);
    return false;
  } catch {
    return true;
  }
}

test.describe.serial("導入・更新・削除（lifecycle）", () => {
  test.describe.configure({ timeout: 40 * 60 * 1000 });

  let head = "";
  let previous = "";

  test.beforeAll(async () => {
    ({ head, previous } = await commits());
    const lan = await defaultIface();
    // 導入は本番と同じ経路。LAN_IFACE は既定経路の回線（経路の切り替えは stack 群の準備で行う）
    await shell(`provision_install "$PWD" "${head}"`, { E2E_INSTALL_LAN_IFACE: lan });
  });

  test.afterAll(async () => {
    // 途中で失敗しても、導入の残りを消して次の群へ持ち越さない
    if (await exists(INSTALLER)) {
      await installer(["uninstall", "--purge"]).catch(() => undefined);
    }
  });

  test("9.1: 導入の後、status が導入済み（導入先・コミット）を示す", async () => {
    const status = await installer(["status"]);
    expect(status.stdout).toContain("導入先:");
    expect(status.stdout).toContain(head.slice(0, 7));
  });

  test("9.2: 別のコミットへ更新すると、status にその版が反映される", async () => {
    await run("git", ["branch", "-f", "e2e-older", previous]);
    await installer(["update", "--ref", "e2e-older"]);
    const status = await installer(["status"]);
    expect(status.stdout).toContain(previous.slice(0, 7));
  });

  test("9.3 / 9.4: --purge なしの削除で、サービスの定義・ホストの規則・取得先は消え、設定とデータは残る", async () => {
    await installer(["uninstall"]);
    const units = await run("sh", ["-c", "systemctl list-unit-files 'vpngwgui*' --no-legend | wc -l"], { encoding: "utf8" });
    expect(units.stdout.trim()).toBe("0");
    expect(await exists(SRC), "取得先（/opt/vpngwgui）が残っている").toBe(false);
    expect(await nftTableAbsent(), "nftables の規則が残っている").toBe(true);
    expect(await exists(CONF), "設定（/etc/vpngwgui）が残っていない").toBe(true);
    expect(await exists(DATA), "データ（/var/lib/vpngwgui）が残っていない").toBe(true);
  });

  test("9.5 / 9.6: --purge で設定とデータが消え、status が未導入を示す", async () => {
    await installer(["uninstall", "--purge"]);
    expect(await exists(CONF), "設定が残っている").toBe(false);
    expect(await exists(DATA), "データが残っている").toBe(false);
    const status = await installer(["status"]);
    expect(status.stdout).toContain("未導入");
  });
});
