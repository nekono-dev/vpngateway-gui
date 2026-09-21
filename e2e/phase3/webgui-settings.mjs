// 責務: Web UIの設定ダイアログから「透過ゲートウェイモード」「Kill Switch」を切り替えて保存し、
// PUT /v1/connection/config が成功して設定が反映される（再読込後のGETに現れる）ことを検証する。
// 実際のnftables反映・LAN端末からの疎通は gateway-scenarios.sh 側で確認する。
// 実行: node e2e/phase3/webgui-settings.mjs http://<GWのIP>:8080 <transparent:on|off> <killSwitch:on|off>

import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, transparentArg, killSwitchArg] = process.argv.slice(2);
const wantTransparent = transparentArg === "on";
const wantKillSwitch = killSwitchArg === "on";

const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");
  await page.getByRole("button", { name: "設定" }).click();
  const dialog = page.getByRole("dialog", { name: "設定" });
  await dialog.getByRole("checkbox", { name: /透過ゲートウェイモード/ }).waitFor();

  // 現在値と異なる場合のみチェック状態を変更する（setCheckedは冪等）
  await dialog.getByRole("checkbox", { name: /透過ゲートウェイモード/ }).setChecked(wantTransparent);
  await dialog.getByRole("checkbox", { name: /Kill Switch/ }).setChecked(wantKillSwitch);
  await dialog.getByRole("button", { name: "保存" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  assert(true, `設定ダイアログの保存が成功して閉じる (transparent=${wantTransparent}, killSwitch=${wantKillSwitch})`);

  // ダイアログを開き直し、保存値がサーバから再取得されて表示されることを確認する
  await page.reload();
  await page.getByRole("button", { name: "設定" }).click();
  const reopened = page.getByRole("dialog", { name: "設定" });
  await reopened.getByRole("checkbox", { name: /透過ゲートウェイモード/ }).waitFor();
  assert(
    (await reopened.getByRole("checkbox", { name: /透過ゲートウェイモード/ }).isChecked()) === wantTransparent,
    "再読込後も透過ゲートウェイモードの値が保持されている",
  );
  assert(
    (await reopened.getByRole("checkbox", { name: /Kill Switch/ }).isChecked()) === wantKillSwitch,
    "再読込後もKill Switchの値が保持されている",
  );
} finally {
  await browser.close();
}
