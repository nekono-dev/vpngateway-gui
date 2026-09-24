// 責務: Phase 26（設定ダイアログのタブ化）を実ブラウザ（Playwright）で検証する。
// 実行: node e2e/phase26/webgui-settings-tabs.mjs <baseUrl>
// 確認内容: 先頭タブの表示・タブ切替・未保存入力の保持・保存後の永続化・保存不可時の警告印・ダイアログの高さ。

import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl] = process.argv.slice(2);
const { browser, page } = await launch(baseUrl);

async function openSettings() {
  await page.goto("/");
  await page.locator("strong.connection-label").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定" });
  await dialog.getByRole("tab", { name: "通信制御" }).waitFor();
  return dialog;
}

try {
  let dialog = await openSettings();
  const relayOnAtStart = (await dialog.getByRole("tab", { name: "DNS詳細" }).count()) === 1;
  assert((await dialog.getByRole("tab").count()) === (relayOnAtStart ? 4 : 3), "タブが表示される（DNS中継が有効なら4つ、無効なら「DNS詳細」を除く3つ）");
  assert((await dialog.getByRole("tab", { name: "通信制御" }).getAttribute("aria-selected")) === "true", "開いた直後は先頭の「通信制御」タブが選択されている");
  assert(await dialog.getByRole("checkbox", { name: /Kill Switch/ }).isVisible(), "通信制御タブにKill Switchが表示される");
  assert((await dialog.getByRole("checkbox", { name: /明示的プロキシモード/ }).count()) === 0, "通信制御タブにはゲートウェイの項目が表示されない");
  const height = (await dialog.boundingBox()).height;
  assert(height < 600, `ダイアログの高さが抑えられている（${Math.round(height)}px）`);
  await page.screenshot({ path: "/tmp/phase26-control.png" });

  await dialog.getByRole("tab", { name: /ゲートウェイ/ }).click();
  assert(await dialog.getByRole("checkbox", { name: /透過ゲートウェイモード/ }).isVisible(), "ゲートウェイタブに透過ゲートウェイモードが表示される");
  assert(await dialog.getByRole("checkbox", { name: /明示的プロキシモード/ }).isVisible(), "ゲートウェイタブに明示的プロキシモードが表示される");
  await page.screenshot({ path: "/tmp/phase26-gateway.png" });

  await dialog.getByRole("tab", { name: /上位DNSリゾルバ/ }).click();
  assert(await dialog.getByRole("checkbox", { name: /DNS中継を有効にする/ }).isVisible(), "上位DNSリゾルバタブにDNS中継の設定が表示される");
  await page.screenshot({ path: "/tmp/phase26-dns.png" });
  // 「DNS詳細」タブはDNS中継が有効な間だけ表示される（保存はしない）
  const relay = dialog.getByRole("checkbox", { name: /DNS中継を有効にする/ });
  const relayBefore = await relay.isChecked();
  await relay.setChecked(!relayBefore);
  assert((await dialog.getByRole("tab", { name: "DNS詳細" }).count()) === (relayBefore ? 0 : 1), "DNS中継のON/OFFに合わせて「DNS詳細」タブが表示・非表示になる");
  await relay.setChecked(relayBefore);

  // 未保存の入力がタブ切替で保持され、保存で一括反映される
  const killSwitch = dialog.getByRole("checkbox", { name: /Kill Switch/ });
  await dialog.getByRole("tab", { name: "通信制御" }).click();
  const before = await killSwitch.isChecked();
  await killSwitch.setChecked(!before);
  await dialog.getByRole("tab", { name: /ゲートウェイ/ }).click();
  await dialog.getByRole("tab", { name: "通信制御" }).click();
  assert((await killSwitch.isChecked()) === !before, "タブを往復してもKill Switchの未保存の変更が保持される");
  await dialog.getByRole("button", { name: "保存" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  dialog = await openSettings();
  assert((await dialog.getByRole("checkbox", { name: /Kill Switch/ }).isChecked()) === !before, "保存後、再読込してもKill Switchの値が保持される");
  await dialog.getByRole("checkbox", { name: /Kill Switch/ }).setChecked(before);
  await dialog.getByRole("button", { name: "保存" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });

  // 保存不可時の警告印（明示的プロキシ有効・許可CIDR空）
  dialog = await openSettings();
  await dialog.getByRole("tab", { name: /ゲートウェイ/ }).click();
  const explicit = dialog.getByRole("checkbox", { name: /明示的プロキシモード/ });
  if (!(await explicit.isChecked())) await explicit.setChecked(true);
  await dialog.getByLabel(/明示的プロキシの許可CIDR/).fill("");
  await dialog.getByRole("tab", { name: "通信制御" }).click();
  assert(await dialog.getByRole("tab", { name: "ゲートウェイ !" }).isVisible(), "保存不可のとき「ゲートウェイ」タブに警告印が付く");
  assert(await dialog.getByRole("button", { name: "保存" }).isDisabled(), "別タブ表示中でも保存ボタンが無効のまま");
  await dialog.getByRole("button", { name: "キャンセル" }).click();

  // 複数行入力欄のスタイル（幅がラベルいっぱい）と、スマートフォン幅での横スクロール
  dialog = await openSettings();
  await dialog.getByRole("tab", { name: /ゲートウェイ/ }).click();
  const cidrBox = dialog.getByLabel(/明示的プロキシの許可CIDR/);
  const cidrWidth = (await cidrBox.boundingBox()).width;
  const labelWidth = (await dialog.getByRole("tabpanel").boundingBox()).width;
  assert(cidrWidth >= labelWidth - 2, `複数行入力欄の幅がパネルいっぱいに揃う（${Math.round(cidrWidth)}/${Math.round(labelWidth)}px）`);
  await page.setViewportSize({ width: 300, height: 700 });
  const style = await cidrBox.evaluate((el) => ({ ws: getComputedStyle(el).whiteSpace }));
  assert(style.ws !== "pre", `スマートフォン幅でも複数行入力欄は折り返す（横スクロールしない。white-space: ${style.ws}）`);
  // 全てのボタンは文字を折り返さず、ボタンごと折り返して配置される（高さが1行分のまま）
  const buttons = await page.getByRole("dialog", { name: "設定" }).getByRole("button").evaluateAll((els) =>
    els.map((el) => ({ text: el.textContent, height: el.getBoundingClientRect().height, ws: getComputedStyle(el).whiteSpace })),
  );
  for (const b of buttons) {
    assert(b.ws === "nowrap" && b.height < 44, `ダイアログのボタン「${b.text}」の文字が折り返されていない（高さ${Math.round(b.height)}px）`);
  }
  const box = async (name) => (await dialog.getByRole("button", { name }).boundingBox());
  const [account, save, cancel] = [await box("アカウント情報を変更"), await box("保存"), await box("キャンセル")];
  assert(Math.abs(save.y - cancel.y) < 2 && cancel.x > save.x, "狭い幅でも「保存」「キャンセル」は横並びのまま");
  assert(account.y < save.y, "収まらない場合、「アカウント情報を変更」と「保存・キャンセル」の組が別の行へ折り返される");
  const tabInfo = await dialog.getByRole("tablist").evaluate((el) => ({ ox: getComputedStyle(el).overflowX, sw: el.scrollWidth, cw: el.clientWidth }));
  assert(tabInfo.ox === "auto" && tabInfo.sw > tabInfo.cw, `タブ列は幅に収まらないとき折り返さず、タブ列だけが横スクロールできる（${tabInfo.sw}>${tabInfo.cw}）`);
  const dlgBox = await dialog.boundingBox();
  assert(Math.abs(dlgBox.x - 9.5) < 1 && Math.abs(dlgBox.width - (300 - 19)) < 1, `スマートフォン幅ではダイアログの左右の余白が約9.5px（従来の約19pxの半分）になる（x=${dlgBox.x}, width=${dlgBox.width}）`);
  const dlgScroll = await dialog.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  assert(dlgScroll.sw <= dlgScroll.cw, `ダイアログ全体は横スクロールしない（${dlgScroll.sw}<=${dlgScroll.cw}）`);
  await dialog.getByRole("tablist").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  assert(await dialog.getByRole("tab", { name: /DNS/ }).last().isVisible(), "タブ列を右へスクロールすると末尾のタブが見える");
  await dialog.getByRole("tablist").evaluate((el) => { el.scrollLeft = 0; });
  await cidrBox.evaluate((el) => { el.disabled = false; });
  await page.setViewportSize({ width: 1280, height: 720 });
  const [wa, ws, wc] = [await box("アカウント情報を変更"), await box("保存"), await box("キャンセル")];
  assert(Math.abs(wa.y - ws.y) < 2 && Math.abs(ws.y - wc.y) < 2, "横幅に収まるときは3つのボタンが1行に表示される");
  await page.setViewportSize({ width: 300, height: 700 });
  await page.screenshot({ path: "/tmp/phase26-mobile.png" });
  const dialogBox = await dialog.boundingBox();
  assert(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 300, "ダイアログが画面幅に収まっている");
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });

  // ラジオボタンの独自スタイル（DNS詳細タブ）
  dialog = await openSettings();
  await dialog.getByRole("tab", { name: /上位DNSリゾルバ/ }).click();
  const relayToggle = dialog.getByRole("checkbox", { name: /DNS中継を有効にする/ });
  const relayInitial = await relayToggle.isChecked();
  if (!relayInitial) await relayToggle.setChecked(true);
  await dialog.getByRole("tab", { name: /DNS詳細/ }).click();
  const radio = dialog.getByRole("radio", { name: /名前解決を止める/ });
  const radioStyle = await radio.evaluate((el) => {
    const c = getComputedStyle(el);
    return { appearance: c.appearance, radius: c.borderRadius, width: c.width };
  });
  assert(radioStyle.appearance === "none" && radioStyle.radius === "50%" && radioStyle.width === "18px", `ラジオボタンが独自の丸型デザインになっている（${JSON.stringify(radioStyle)}）`);
  await page.screenshot({ path: "/tmp/phase26-radio.png" });
  await dialog.getByRole("button", { name: "キャンセル" }).click();

  // 通知（トースト）の表示位置: PC幅は右上、スマートフォン幅は画面下部
  await page.evaluate(() => {
    const region = document.querySelector(".toast-region");
    if (!region) { const d = document.createElement("div"); d.className = "toast-region"; d.id = "e2e-toast"; d.innerHTML = '<div class="toast toast-success">t</div>'; document.body.appendChild(d); }
  });
  const toastRegion = page.locator(".toast-region").first();
  const pcPos = await toastRegion.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, right: window.innerWidth - r.right }; });
  assert(pcPos.top < 50 && pcPos.right < 50, `PC幅では通知が右上に表示される（top=${Math.round(pcPos.top)}, right=${Math.round(pcPos.right)}）`);
  await page.setViewportSize({ width: 300, height: 700 });
  const mobilePos = await toastRegion.evaluate((el) => { const r = el.getBoundingClientRect(); return { bottom: window.innerHeight - r.bottom, left: r.left, width: r.width }; });
  assert(mobilePos.bottom < 50 && mobilePos.left + mobilePos.width <= 300, `スマートフォン幅では通知が画面下部に表示される（bottom=${Math.round(mobilePos.bottom)}）`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => document.getElementById("e2e-toast")?.remove());

  // 接続先リストのツールバー: 収まらない幅では折り返さず横スクロールできる
  await page.setViewportSize({ width: 300, height: 700 });
  await page.goto("/");
  const toolbar = page.locator(".location-toolbar");
  await toolbar.waitFor({ timeout: 30000 });
  const tb = await toolbar.evaluate((el) => ({ ox: getComputedStyle(el).overflowX, wrap: getComputedStyle(el).flexWrap, sw: el.scrollWidth, cw: el.clientWidth }));
  assert(tb.ox === "auto" && tb.wrap === "nowrap", `ツールバーは折り返さず横スクロール可能（${tb.ox}/${tb.wrap}）`);
  assert(tb.sw > tb.cw, `300px幅ではツールバーが幅を超え、スクロールで表示できる（${tb.sw}>${tb.cw}）`);
  const tabH = await page.locator(".location-tabs button").first().evaluate((el) => el.getBoundingClientRect().height);
  assert(tabH > 28, `ツールバーのタブが縦に潰れていない（高さ${Math.round(tabH)}px）`);
  // 現在の接続先と別の行を選ぶと［接続先を変更］が出る（接続中のときのみ。［再計測］の左に並ぶ）
  const other = page.getByRole("radio").filter({ hasNot: page.locator("[aria-current]") }).nth(1);
  if ((await page.locator("strong.connection-label").innerText()).includes("接続中")) {
    await other.check({ force: true });
    const labels = await page.locator(".location-toolbar-actions button").allInnerTexts();
    assert(labels[0] === "接続先を変更" && labels[1] === "再計測", `［接続先を変更］が［再計測］の左に並ぶ（${labels.join(" / ")}）`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  // アカウント情報ボタンはタブと無関係に使える
  dialog = await openSettings();
  await dialog.getByRole("button", { name: "アカウント情報を変更" }).click();
  await page.getByRole("dialog", { name: /アカウント/ }).waitFor({ timeout: 5000 });
  assert(true, "アカウント情報ダイアログが従来どおり開く");
} finally {
  await browser.close();
}
