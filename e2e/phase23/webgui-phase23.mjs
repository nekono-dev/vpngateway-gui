// 責務: Phase23（ベンダー選択のプルダウン化・PWA対応・モバイルのスクロール防止・入力欄枠線色の変更）の
// Web UI側の実機確認。実ブラウザで
// 1) VPNベンダーの選択がラジオボタンではなくプルダウン（select）になっていること。
// 2) プルダウンがブラウザ既定の見た目（appearance）を使わず、テキストボックス風に装飾されていること。
// 3) 入力欄の枠線色が紫（旧--input-border）ではなくグレー系に変わっていること。
// 4) プルダウンの隣（同じ行）にログイン/ログアウトボタンが配置され、デッドスペースが減っていること。
// 5) manifest・Service Worker登録コード・アイコンが配信されること（PWA対応。実機はHTTPではない
//    LAN配信のためSWの実際の有効化はセキュアコンテキスト要件により確認できない。配信されることのみ確認する）。
// 6) デスクトップ幅・モバイル幅（375x667・320x568）のいずれでも、ページ全体がビューポートに収まり
//    スクロール・横方向のはみ出しが発生しないこと。
// を確認する。ベンダー切替を伴うため、検証後は検証開始時点の選択中ベンダー（Proton VPN）へ戻す。
// 使い方: node e2e/phase23/webgui-phase23.mjs <baseUrl>

import { launch, assert } from "../lib/playwright.mjs";

const baseUrl = process.argv[2] ?? "http://192.168.3.240:8080";

/** 目的: 指定ビューポートで、プルダウンの装飾・行内配置・ページ高さを確認する。 */
async function checkViewport(width, height, label) {
  const { browser, page } = await launch(baseUrl);
  try {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    assert(manifestHref === "/manifest.webmanifest", `${label}: manifestリンクがある（実際: ${manifestHref}）`);

    const select = page.getByRole("combobox", { name: "VPNベンダー" });
    assert((await select.count()) > 0, `${label}: VPNベンダーのプルダウン(select)が存在する`);
    assert((await page.locator('.provider-card [role="radiogroup"]').count()) === 0, `${label}: ラジオボタン(radiogroup)が残っていない`);

    const style = await select.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { appearance: computed.appearance, borderColor: computed.borderColor };
    });
    assert(style.borderColor === "rgb(110, 119, 129)", `${label}: プルダウンの枠線がグレー系(--input-border)である（実際: ${style.borderColor}）`);
    assert(style.borderColor !== "rgb(110, 64, 201)", `${label}: 旧・紫色の枠線ではない`);
    assert(style.appearance === "none", `${label}: システムUIの矢印を消してテキストボックス風にしている（実際: ${style.appearance}）`);

    const providerCard = page.locator("section.provider-card");
    const box = await providerCard.evaluate((el) => {
      const selectEl = el.querySelector(".provider-select-row, .provider-name");
      const actionEl = el.querySelector(".session-action");
      const s = selectEl.getBoundingClientRect();
      const a = actionEl.getBoundingClientRect();
      return { sTop: s.top, sBottom: s.bottom, aTop: a.top, aBottom: a.bottom, aHasContent: actionEl.textContent.trim().length > 0 };
    });
    if (box.aHasContent) {
      const overlap = Math.min(box.sBottom, box.aBottom) - Math.max(box.sTop, box.aTop);
      assert(overlap > 0, `${label}: プルダウンとログイン/ログアウトボタンが同じ行にある`);
    }

    const scroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    assert(scroll.scrollHeight <= scroll.clientHeight + 2, `${label}: ページ全体がビューポート内に収まる（scrollHeight=${scroll.scrollHeight}, clientHeight=${scroll.clientHeight}）`);

    const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(hOverflow <= 1, `${label}: 横方向のはみ出しが無い（実際: ${hOverflow}px）`);
  } finally {
    await browser.close();
  }
}

await checkViewport(1280, 800, "デスクトップ幅");
await checkViewport(375, 667, "モバイル幅(375x667)");
await checkViewport(320, 568, "モバイル幅(320x568, 小型)");

// PWAの静的資材（manifest・Service Worker・アイコン）が配信されることを確認する。
for (const path of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
  const response = await fetch(new URL(path, baseUrl));
  assert(response.ok, `PWA資材が配信される: ${path}（status=${response.status}）`);
}

// --- ベンダー切替を伴う確認（プルダウンでの切替・ログアウトボタンの行内配置） ---
{
  const { browser, page } = await launch(baseUrl);
  try {
    await page.goto("/");
    await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);
    const select = page.getByRole("combobox", { name: "VPNベンダー" });

    // AdGuard VPN（ログイン済み）へ切替: ログアウトボタンがプルダウンと同じ行・右側に並ぶことを確認する。
    await select.selectOption("adguardvpn");
    await page.waitForFunction(() => document.getElementById("provider-select")?.value === "adguardvpn", { timeout: 10000 });
    const providerCard = page.locator("section.provider-card");
    const logoutButton = providerCard.getByRole("button", { name: "ログアウト" });
    assert((await logoutButton.count()) > 0, "ログイン済みベンダー(AdGuard VPN)ではログアウトボタンが表示される");
    const rowCheck = await providerCard.evaluate((el) => {
      const selectWrap = el.querySelector(".provider-select-row");
      const action = el.querySelector(".session-action");
      const s = selectWrap.getBoundingClientRect();
      const a = action.getBoundingClientRect();
      return { sameRow: Math.abs(s.top - a.top) < 5, selectRight: s.right, actionLeft: a.left };
    });
    assert(rowCheck.sameRow, "プルダウンとログアウトボタンが同じ行にある（AdGuard VPN）");
    assert(rowCheck.actionLeft >= rowCheck.selectRight - 2, "ログアウトボタンがプルダウンの右側にある");

    // 検証環境の既知の既定状態（Phase22時点からProton VPN選択中）へ戻す。
    await select.selectOption("protonvpn");
    await page.waitForFunction(() => document.getElementById("provider-select")?.value === "protonvpn", { timeout: 10000 });
    assert((await select.inputValue()) === "protonvpn", "検証環境の既定（Proton VPN選択中）へ戻した");
  } finally {
    await browser.close();
  }
}

console.log("ALL PASS");
