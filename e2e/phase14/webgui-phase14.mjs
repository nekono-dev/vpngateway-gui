// 責務: Phase 14（ドメイン迂回とDNS中継）のWeb UI操作を、実proxyに接続したWeb UIでPlaywright検証する。
// 実行: node e2e/phase14/webgui-phase14.mjs <baseUrl> <DoHのCA証明書ファイル> [スクリーンショットの出力先ディレクトリ]
//   1. 設定ダイアログにDNS中継のグループが出て、「未対応」の暫定表示は出ない。ドメインの表記規則の案内が出る
//   2. DNS中継が無効のまま迂回ドメインを入力すると「反映されません」と出る
//   3. 有効化して上流（DoH）・CA・迂回ドメインを入力して保存でき、再度開くと保存値が保持されている
//   4. 稼働状況の「DNS中継」欄が「稼働中」になる（上流の疎通・迂回中のIP数の表示）
//   5. 上流も公開DNSも空のままでは保存できない
// 前提: ゲートウェイ役（lab.shのp14-gw）のWeb UIへ到達できること（検証サーバのlxc proxyデバイス等でポートを公開する）。
//       終了時にDNS中継の設定を無効へ戻す。

import { readFileSync } from "node:fs";
import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, caFile, shotDir] = process.argv.slice(2);
const caPem = readFileSync(caFile, "utf8");
const POLL_WAIT_MS = 20000;
const { browser, page } = await launch(baseUrl);

const dnsRow = () => page.getByTestId("status-dns-relay");

async function openSettings() {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定" });
  await dialog.getByRole("checkbox", { name: /DNS中継を有効にする/ }).waitFor();
  return dialog;
}

async function shot(name) {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true });
}

try {
  await page.locator("strong.connection-label").waitFor({ timeout: 30000 });

  let dialog = await openSettings();
  assert((await dialog.getByText(/未対応/).count()) === 0, "「未対応」の暫定表示は出ない");
  assert(await dialog.getByText(/example\.com と \*\.example\.com の両方を登録/).isVisible(), "ドメインの表記規則（両方の登録が必要）の案内が出る");
  assert(await dialog.getByLabel(/自宅DNSサーバ（DoHのURL）/).isDisabled(), "DNS中継が無効の間は、上流のURL欄が無効化されている");

  await dialog.getByRole("textbox", { name: /迂回ドメイン（split-tunnel/ }).fill("a.example.test\n*.wild.example.test");
  assert(await dialog.getByText("DNS中継が無効なため、迂回ドメインは反映されません。").isVisible(), "DNS中継が無効なまま迂回ドメインがあると、反映されない旨が出る");
  await shot("01-disabled-notice");

  await dialog.getByRole("checkbox", { name: /DNS中継を有効にする/ }).setChecked(true);
  // 以前の検証の設定が残っていても、上流・切り替え先を空にした状態から始める。
  await dialog.getByLabel(/自宅DNSサーバ（DoHのURL）/).fill("");
  await dialog.getByRole("radio", { name: /名前解決を止める/ }).check();
  assert(await dialog.getByRole("button", { name: "保存" }).isDisabled(), "上流も公開DNSも空のままでは保存できない");
  assert(await dialog.getByText(/自宅DNSサーバのURLか、切り替え先の公開DNSを入力/).isVisible(), "保存できない理由が示される");

  await dialog.getByLabel(/自宅DNSサーバ（DoHのURL）/).fill("https://10.98.1.40/dns-query");
  await dialog.getByLabel(/自宅DNSサーバの証明書を発行したCA/).fill(caPem);
  await dialog.getByRole("radio", { name: /公開DNSへ切り替える/ }).check();
  assert(await dialog.getByRole("button", { name: "保存" }).isDisabled(), "「公開DNSへ切り替える」で切り替え先が空なら保存できない");
  await dialog.getByLabel(/切り替え先の公開DNS/).fill("1.1.1.1");
  await dialog.getByRole("checkbox", { name: /手動でDNSを指定した端末/ }).setChecked(true);
  await dialog.getByLabel(/中継しない宛先/).fill("192.168.3.5/32");
  await shot("02-filled");
  await dialog.getByRole("button", { name: "保存" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  assert(true, "DNS中継の設定を保存でき、ダイアログが閉じる");

  await dnsRow().locator(".badge", { hasText: "稼働中" }).waitFor({ timeout: POLL_WAIT_MS });
  assert(true, "稼働状況の「DNS中継」欄が「稼働中」になる");
  assert((await dnsRow().innerText()).includes("迂回中のIP"), "迂回中のIP数が表示される");
  await shot("03-dashboard");

  await page.reload();
  await page.locator("strong.connection-label").waitFor({ timeout: 30000 });
  dialog = await openSettings();
  assert((await dialog.getByRole("textbox", { name: /迂回ドメイン（split-tunnel/ }).inputValue()) === "a.example.test\n*.wild.example.test", "再読込後も迂回ドメインが保持されている");
  assert((await dialog.getByLabel(/自宅DNSサーバ（DoHのURL）/).inputValue()) === "https://10.98.1.40/dns-query", "再読込後も上流URLが保持されている");
  assert(await dialog.getByRole("radio", { name: /公開DNSへ切り替える/ }).isChecked(), "再読込後も「公開DNSへ切り替える」が保持されている");
  assert((await dialog.getByLabel(/切り替え先の公開DNS/).inputValue()) === "1.1.1.1", "再読込後も切り替え先の公開DNSが保持されている");
  assert(await dialog.getByRole("checkbox", { name: /手動でDNSを指定した端末/ }).isChecked(), "再読込後もリダイレクトの設定が保持されている");
  await shot("04-reopened");

  // 後始末: DNS中継と迂回ドメインを無効に戻す
  await dialog.getByRole("checkbox", { name: /DNS中継を有効にする/ }).setChecked(false);
  await dialog.getByRole("textbox", { name: /迂回ドメイン（split-tunnel/ }).fill("");
  await dialog.getByRole("button", { name: "保存" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  await dnsRow().locator(".badge", { hasText: "停止" }).waitFor({ timeout: POLL_WAIT_MS });
  assert(true, "DNS中継を無効に戻すと、稼働状況が「停止」になる");
} finally {
  await browser.close();
}
