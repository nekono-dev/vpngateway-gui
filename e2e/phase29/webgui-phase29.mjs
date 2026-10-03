// 責務: Phase29（ゲートウェイ機の再起動）のWeb UI側のPlaywright検証。
// モード:
//   wrong   : ヘッダーに「ゲートウェイ再起動」ボタンが「接続ログ」の隣にあり、誤ったパスワードでは再起動されずエラーが出ること。
//   request : 正しいパスワードで依頼が受け付けられ、「再起動を依頼しました」が表示されること（この後ホストが再起動する）。
// 使い方: node e2e/phase29/webgui-phase29.mjs <baseUrl> <wrong|request> [スクリーンショットの出力先]

import { launch, assert, E2E_PASSWORD } from "../lib/playwright.mjs";

const baseUrl = process.argv[2] ?? "https://192.168.3.240";
const mode = process.argv[3] ?? "wrong";
const shot = process.argv[4];
const { browser, page } = await launch(baseUrl);
try {
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ state: "visible", timeout: 15000 });

  const logButton = page.getByRole("button", { name: "接続ログ" });
  const rebootButton = page.getByRole("button", { name: "ゲートウェイ再起動" });
  assert((await rebootButton.count()) === 1, "ヘッダーに「ゲートウェイ再起動」ボタンがある");
  const placement = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".header-actions button")].map((b) => b.textContent?.trim());
    return buttons.indexOf("ゲートウェイ再起動") - buttons.indexOf("接続ログ");
  });
  assert(placement === 1, "「接続ログ」ボタンの隣に並んでいる");
  assert((await logButton.count()) === 1, "「接続ログ」ボタンも残っている");

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
