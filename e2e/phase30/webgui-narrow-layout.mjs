// 責務: 狭い画面幅でのヘッダータイトル非表示（カード幅569px未満＝画面幅601px未満）と、ページ・設定ダイアログの
//       左右余白の連続的な変化（601px以上で16px、589px以下で10px、その間は線形）のPlaywright検証。
// 使い方: node e2e/phase30/webgui-narrow-layout.mjs <baseUrl> [スクリーンショットの出力先ディレクトリ]

import { launch, assert } from "../lib/playwright.mjs";

const baseUrl = process.argv[2] ?? "https://192.168.3.240";
const shotDir = process.argv[3];
const { browser, page } = await launch(baseUrl);
try {
  // launch()はデスクトップ幅でログインを済ませる。以降は幅を変えて確認する。
  const cases = [
    [1024, false, 16], [640, false, 16], [601, false, 16], [600, true, 15.5],
    [595, true, 13], [589, true, 10], [500, true, 10], [375, true, 10], [320, true, 10],
  ];
  for (const [width, narrow, gutter] of cases) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(200);
    const titleDisplay = await page.locator(".app-header h1").evaluate((e) => getComputedStyle(e).display);
    assert((titleDisplay === "none") === narrow, `幅${width}px: タイトルは${narrow ? "非表示" : "表示"}`);
    const labels = await page.locator(".header-actions button").allInnerTexts();
    assert(["接続ログ", "設定"].every((l) => labels.some((t) => t.includes(l))), `幅${width}px: ヘッダーの操作ボタンが残っている（${labels.join("/")}）`);
    const bar = await page.locator(".header-actions").evaluate((e) => ({
      overflowing: e.scrollWidth > e.clientWidth + 1,
      wrapped: new Set([...e.querySelectorAll("button")].map((b) => b.getBoundingClientRect().top)).size > 1,
      scrolled: (() => { e.scrollLeft = e.scrollWidth; return e.scrollLeft > 0; })(),
    }));
    assert(!bar.wrapped, `幅${width}px: ヘッダーのボタンが折り返さない`);
    assert(bar.overflowing === bar.scrolled, `幅${width}px: ボタン列が幅を超えるときだけ横スクロールできる（超過=${bar.overflowing}）`);
    await page.locator(".header-actions").evaluate((e) => { e.scrollLeft = 0; });
    if (narrow && !bar.overflowing) {
      const edges = await page.evaluate(() => ({
        header: document.querySelector(".app-header").getBoundingClientRect().right,
        lastButton: [...document.querySelectorAll(".header-actions button")].at(-1).getBoundingClientRect().right,
      }));
      assert(Math.abs(edges.header - edges.lastButton) < 1, `幅${width}px: ボタンが右寄せ`);
    }
    const padding = await page.locator("main").evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
    assert(Math.abs(padding - gutter) < 0.6, `幅${width}px: ページの左右余白が${gutter}px（実測${padding}px）`);

    await page.getByRole("button", { name: "設定" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    const d = await dialog.boundingBox();
    const expected = Math.min(602, width - 2 * gutter);
    assert(Math.abs(d.width - expected) < 1.2, `幅${width}px: ダイアログ幅が${expected}px（実測${d.width}px）`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!overflow, `幅${width}px: 横スクロールが発生しない`);
    if (shotDir) await page.screenshot({ path: `${shotDir}/narrow-${width}.png` });
    await page.keyboard.press("Escape");
    await dialog.getByRole("dialog").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
  }
  console.log("ALL PASS");
} finally {
  await browser.close();
}
