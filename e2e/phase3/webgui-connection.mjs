// 責務: Web UIから実VPNの接続・切断を操作し、画面上の接続状態表示（ポーリングで更新）が切り替わることを検証する。
// 実行:
//   node e2e/phase3/webgui-connection.mjs <baseUrl> connect <country例:jp>
//   node e2e/phase3/webgui-connection.mjs <baseUrl> disconnect
// 接続状態カードの表示は5秒間隔ポーリングで更新されるため、待機上限は余裕を持って60秒とする。

import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, action, country] = process.argv.slice(2);
const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");
  // 接続状態カード（接続中/切断）が出るまで待つ。ここで出なければ未ログイン等でAPIが失敗している
  await page.locator("strong", { hasText: /^(接続中|切断)$/ }).first().waitFor({ timeout: 30000 });

  if (action === "connect") {
    await page.getByLabel("接続国").selectOption(country);
    await page.getByRole("button", { name: "接続", exact: true }).click();
    await page.locator("strong", { hasText: "接続中" }).waitFor({ timeout: 60000 });
    assert(true, `Web UIから接続(${country})でき、画面が「接続中」表示に切り替わる`);
  } else if (action === "disconnect") {
    await page.getByRole("button", { name: "切断", exact: true }).click();
    await page.locator("strong", { hasText: /^切断$/ }).waitFor({ timeout: 60000 });
    assert(true, "Web UIから切断でき、画面が「切断」表示に切り替わる");
  } else {
    throw new Error(`unknown action: ${action}`);
  }
} finally {
  await browser.close();
}
