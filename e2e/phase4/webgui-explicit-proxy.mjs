// 責務: Phase 4（明示的プロキシ）のWeb UI操作を、実proxy（3proxy）に接続したWeb UIでPlaywright検証する。
// 実行: node e2e/phase4/webgui-explicit-proxy.mjs <baseUrl> <step> [引数...]
//   enable <cidr>   : 設定ダイアログで明示的プロキシを有効化し許可CIDRを保存 → 稼働状況が「稼働中」＋ポート表示になる
//   reopen <cidr>   : 再読み込み後の設定ダイアログに保存値（有効・CIDR）が保持されている
//   invalid         : 不正なCIDRを保存しようとするとダイアログ内にエラーが出て、保存されない
//   empty           : 有効のまま許可CIDRを空にして保存 → 稼働状況が「未構成（許可CIDRが空）」になる
//   disable         : 無効化 → 稼働状況が「停止」になり、許可CIDR欄がdisabledになる
//   crashloop       : （別途3proxyを連続killした状態で）稼働状況が「起動失敗を繰り返しています」になる
// 稼働状況は5秒ポーリングで更新されるため、待機上限は余裕を持って20秒とする。

import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, step, ...args] = process.argv.slice(2);
const POLL_WAIT_MS = 20000;
const { browser, page } = await launch(baseUrl);

const explicitProxyRow = () => page.getByTestId("status-explicit-proxy");

async function openDashboard() {
  await page.goto("/");
  await page.locator("strong.connection-label").waitFor({ timeout: 30000 });
}

async function openSettings() {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定" });
  await dialog.getByRole("checkbox", { name: /明示的プロキシモード/ }).waitFor();
  return dialog;
}

/** 設定ダイアログで明示的プロキシの有効/無効とCIDR（省略時は変更しない）を設定して保存ボタンを押す。 */
async function saveExplicitProxy(dialog, enabled, cidrs) {
  await dialog.getByRole("checkbox", { name: /明示的プロキシモード/ }).setChecked(enabled);
  if (cidrs !== undefined) {
    await dialog.getByLabel(/明示的プロキシの許可CIDR/).fill(cidrs);
  }
  await dialog.getByRole("button", { name: "保存" }).click();
}

try {
  await openDashboard();

  if (step === "enable") {
    const [cidr] = args;
    const dialog = await openSettings();
    await saveExplicitProxy(dialog, true, cidr);
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
    assert(true, "明示的プロキシを有効化・許可CIDRを指定して保存でき、ダイアログが閉じる");
    await explicitProxyRow().locator(".badge", { hasText: "稼働中" }).waitFor({ timeout: POLL_WAIT_MS });
    assert(true, "稼働状況の明示的プロキシ欄が「稼働中」になる");
    assert(
      (await explicitProxyRow().innerText()).includes("SOCKS5 :1080 / HTTP :3128"),
      "稼働中表示にSOCKS5・HTTPの待ち受けポートが併記される",
    );
  } else if (step === "reopen") {
    const [cidr] = args;
    const dialog = await openSettings();
    assert(await dialog.getByRole("checkbox", { name: /明示的プロキシモード/ }).isChecked(), "再読み込み後も明示的プロキシが有効のまま保持されている");
    assert(
      (await dialog.getByLabel(/明示的プロキシの許可CIDR/).inputValue()).trim() === cidr,
      "再読み込み後も許可CIDRが保持されている",
    );
    await dialog.getByRole("button", { name: "キャンセル" }).click();
  } else if (step === "invalid") {
    const dialog = await openSettings();
    await saveExplicitProxy(dialog, true, "192.168.3.0/24\nnot-a-cidr");
    await dialog.getByRole("alert").waitFor({ timeout: 15000 });
    assert(await dialog.isVisible(), "不正なCIDRの保存はダイアログ内にエラーを表示し、ダイアログは閉じない");
    await dialog.getByRole("button", { name: "キャンセル" }).click();
  } else if (step === "empty") {
    const dialog = await openSettings();
    await saveExplicitProxy(dialog, true, "");
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
    await explicitProxyRow().locator(".badge", { hasText: "未構成（許可CIDRが空）" }).waitFor({ timeout: POLL_WAIT_MS });
    assert(true, "有効のまま許可CIDRが空だと「未構成（許可CIDRが空）」が表示される（起動しない）");
  } else if (step === "disable") {
    const dialog = await openSettings();
    await saveExplicitProxy(dialog, false);
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
    await explicitProxyRow().locator(".badge", { hasText: "停止" }).waitFor({ timeout: POLL_WAIT_MS });
    assert(true, "無効化すると稼働状況が「停止」になる");
    const reopened = await openSettings();
    assert(await reopened.getByLabel(/明示的プロキシの許可CIDR/).isDisabled(), "無効の間は許可CIDR欄がdisabledになる");
    await reopened.getByRole("button", { name: "キャンセル" }).click();
  } else if (step === "crashloop") {
    await explicitProxyRow().locator(".badge", { hasText: "起動失敗を繰り返しています" }).waitFor({ timeout: POLL_WAIT_MS });
    assert(true, "クラッシュループ中は稼働状況に「起動失敗を繰り返しています」が危険色で表示される");
  } else {
    throw new Error(`unknown step: ${step}`);
  }
} finally {
  await browser.close();
}
