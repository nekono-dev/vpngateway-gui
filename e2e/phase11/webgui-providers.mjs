// 責務: Phase 11（Web UIからのVPNベンダー選択）の完了基準を、2ベンダー（AdGuard VPN・モックProton VPN）を有効にした
// Web UIをPlaywrightで操作して検証する。
// 実行: node e2e/phase11/webgui-providers.mjs <baseUrl> <step>
//   initial            : 選択部品が表示され、先頭のAdGuard VPNが選択中。両方とも利用可能
//   switch-idle        : 切断中にモックへ切り替え（確認なし）。画面がモックのものへ入れ替わり、再読み込み・別ブラウザでも共通
//   mock-login-connect : モックへログイン（入力型）し、自動接続する
//   switch-decline     : 接続中の切替で確認を拒否 → 何も変わらない
//   switch-accept      : 接続中の切替で確認を承諾 → 切断され、AdGuard VPNへ切り替わる
//   switch-back        : モックへ戻すと、ログイン状態が保持されている（ベンダー別の状態が独立）
//   unavailable        : モックのランナー停止中、モックが「利用不可」で選択できない（シェル側で停止・再開する）
// 前提: e2e/phase11/provider-scenarios.shが起動した構成。

import { launch, assert, chromium } from "../lib/playwright.mjs";

const [baseUrl, step] = process.argv.slice(2);
const MOCK_NAME = "Proton VPN（モック）";
const { browser, page } = await launch(baseUrl);

const status = () => page.locator("strong.connection-label");
const providerRadio = (name) => page.getByRole("radio", { name: new RegExp(name.replace(/[()（）]/g, "\\$&")) });

async function openDashboard() {
  await page.goto("/");
  // 未ログインのAdGuard VPNが選択中のときは接続状態の取得が失敗し（`connection-label`が出ない）、
  // それでも選択部品は表示される。ここでは選択部品だけを待つ。
  await page.getByRole("radiogroup", { name: "VPNベンダー" }).waitFor({ timeout: 30000 });
}

try {
  await openDashboard();

  if (step === "initial") {
    assert(await providerRadio("AdGuard VPN").isChecked(), "先頭のAdGuard VPNが選択中");
    assert(!(await providerRadio(MOCK_NAME).isChecked()), "モックは選択されていない");
    assert(await providerRadio(MOCK_NAME).isEnabled(), "モックは利用可能（ランナーが起動している）");
    assert(await page.getByRole("button", { name: "VPNベンダーへログイン" }).isVisible(), "AdGuard VPN（URL提示型）のログイン導線が表示される");
  } else if (step === "switch-idle") {
    page.once("dialog", () => {
      throw new Error("切断中の切替では確認ダイアログを出さない");
    });
    await providerRadio(MOCK_NAME).click();
    await page.getByText(`${MOCK_NAME}へ切り替えました`).waitFor({ timeout: 30000 });
    await page.getByLabel("パスワード").waitFor({ timeout: 15000 });
    assert(await providerRadio(MOCK_NAME).isChecked(), "モックが選択中になる");
    assert((await page.getByRole("button", { name: "VPNベンダーへログイン" }).count()) === 0, "AdGuardのログイン導線は消え、モックの入力型ログインフォームに入れ替わる");
    assert(await page.getByText(`（${MOCK_NAME}）`).isVisible(), "状態カードのベンダー名が入れ替わる");
    // サーバ側に保持される: 再読み込み・別ブラウザ（別コンテキスト）でも同じ
    await page.reload();
    await page.getByRole("radiogroup", { name: "VPNベンダー" }).waitFor({ timeout: 15000 });
    assert(await providerRadio(MOCK_NAME).isChecked(), "再読み込みしても選択が保持される");
    const other = await browser.newPage({ baseURL: baseUrl });
    await other.goto("/");
    await other.getByRole("radiogroup", { name: "VPNベンダー" }).waitFor({ timeout: 15000 });
    assert(await other.getByRole("radio", { name: new RegExp(MOCK_NAME.replace(/[()（）]/g, "\\$&")) }).isChecked(), "別のブラウザでも同じベンダーが選択されている");
    await other.close();
  } else if (step === "mock-login-connect") {
    await page.getByLabel("ユーザー名").fill("free@example.com");
    await page.getByLabel("パスワード").fill("mock-pass");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await page.locator(".session-status").filter({ hasText: "ログイン済み（プラン: Free）" }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "接続", exact: true }).click();
    await status().filter({ hasText: "接続中" }).waitFor({ timeout: 30000 });
    assert(true, "モックにログインし、自動接続で接続中になる");
  } else if (step === "switch-decline") {
    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await providerRadio("AdGuard VPN").click();
    await page.waitForTimeout(1500);
    assert(message.includes("切断") && message.includes("Kill Switch"), `確認ダイアログに、切断されること・Kill Switchでの遮断が示される（${message.slice(0, 40)}…）`);
    assert(await providerRadio(MOCK_NAME).isChecked(), "確認を拒否すると選択は変わらない");
    await status().filter({ hasText: "接続中" }).waitFor({ timeout: 15000 });
    assert(true, "接続も維持される");
  } else if (step === "switch-accept") {
    page.once("dialog", (dialog) => void dialog.accept());
    await providerRadio("AdGuard VPN").click();
    await page.getByText("AdGuard VPNへ切り替えました").waitFor({ timeout: 60000 });
    // 切替の成功通知は、一覧の再取得より先に出る。選択中の表示が入れ替わるのを待つ。
    await page.waitForFunction(() => document.querySelector("input[name=provider]:checked")?.parentElement?.textContent?.includes("AdGuard VPN"), undefined, { timeout: 15000 });
    assert(await providerRadio("AdGuard VPN").isChecked(), "確認を承諾するとAdGuard VPNが選択中になる");
    // 未ログインのAdGuard VPNは接続状態の取得が失敗する（状態カードはエラー表示）ため、ログインフォームではなくURL提示型の導線を確認する。
    await page.getByRole("button", { name: "VPNベンダーへログイン" }).waitFor({ timeout: 15000 });
    assert(true, "画面がAdGuard VPN（URL提示型のログイン導線）へ入れ替わる");
  } else if (step === "switch-back") {
    await providerRadio(MOCK_NAME).click();
    await page.getByText(`${MOCK_NAME}へ切り替えました`).waitFor({ timeout: 30000 });
    await page.locator(".session-status").filter({ hasText: "ログイン済み（プラン: Free）" }).waitFor({ timeout: 15000 });
    assert(true, "モックへ戻すと、ログイン状態（Free）が保持されている（ベンダー別の状態が独立）");
    assert((await page.getByLabel("パスワード").count()) === 0, "ログインフォームは出ない");
  } else if (step === "unavailable") {
    const radio = providerRadio(MOCK_NAME);
    await page.getByText(/利用不可: ランナーが起動していません/).waitFor({ timeout: 20000 });
    assert(await radio.isDisabled(), "ランナー停止中のベンダーは選択できない");
  } else {
    throw new Error(`unknown step: ${step}`);
  }
} finally {
  await browser.close();
}
