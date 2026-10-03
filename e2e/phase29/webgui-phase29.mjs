// 責務: Phase29（ゲートウェイ機の再起動）のWeb UI側のPlaywright検証。
// モード:
//   wrong   : 設定ダイアログの「メンテナンス」タブに「ゲートウェイ再起動」ボタンがあり（ヘッダーには無く）、誤ったパスワードでは再起動されずエラーが出ること。
//   request : 正しいパスワードで依頼が受け付けられ、「再起動を依頼しました」が表示されること（この後ホストが再起動する）。
// 使い方: node e2e/phase29/webgui-phase29.mjs <baseUrl> <wrong|request> [スクリーンショットの出力先]

import { launch, assert, E2E_PASSWORD } from "../lib/playwright.mjs";

const baseUrl = process.argv[2] ?? "https://192.168.3.240";
const mode = process.argv[3] ?? "wrong";
const shot = process.argv[4];
const { browser, page } = await launch(baseUrl);
try {
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ state: "visible", timeout: 15000 });

  assert((await page.locator(".header-actions").getByRole("button", { name: "ゲートウェイ再起動" }).count()) === 0, "ヘッダーに「ゲートウェイ再起動」ボタンは無い");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "設定" });
  await settings.getByRole("tab", { name: "メンテナンス" }).click();
  const rebootButton = settings.getByRole("button", { name: "ゲートウェイ再起動" });
  assert((await rebootButton.count()) === 1, "メンテナンスタブに「ゲートウェイ再起動」ボタンがある");

  await rebootButton.click();
  const dialog = page.getByRole("dialog", { name: "ゲートウェイ再起動" });
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  assert((await dialog.getByText(/通信が止まります/).count()) > 0, "確認ダイアログに、通信が止まる旨の警告がある");

  if (mode === "wrong") {
    await dialog.getByLabel(/パスワード/).fill("wrong-password");
    await dialog.getByRole("button", { name: "再起動" }).click();
    await dialog.getByRole("alert").waitFor({ timeout: 10000 });
    assert((await dialog.getByRole("alert").innerText()).includes("パスワードが正しくありません"), "誤ったパスワードはダイアログ内にエラー表示される");
    if (shot) await page.screenshot({ path: shot });
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    assert(true, "キャンセルで閉じられる");
  } else {
    await dialog.getByLabel(/パスワード/).fill(E2E_PASSWORD);
    await dialog.getByRole("button", { name: "再起動" }).click();
    await dialog.getByRole("status").waitFor({ timeout: 10000 });
    assert((await dialog.getByRole("status").innerText()).includes("再起動を依頼しました"), "正しいパスワードで再起動の依頼が受け付けられる");
    if (shot) await page.screenshot({ path: shot });
  }
  console.log("ALL PASS");
} finally {
  await browser.close();
}
