// 責務: Phase22（モバイル表示・入力欄の視認性改善）のWeb UI側の実機確認。実ブラウザで
// 1) 入力欄（テキストボックス）の文字サイズ・枠線色・paddingが変更後の値になっていること。
// 2) 「アカウント: 未ログイン」が表示されないこと（ログイン済み・未ログインどちらの状態でも）。
// 3) ログイン済みのとき、ログイン状態が色付きバッジ（badge-ok）で示されること。
// 4) 接続先リスト・参考一覧のいずれにも表示項目が無いとき、接続操作カード（.controls）が
//    展開クラス（controls-expanded）を持たず、画面の残り高さを不要に占有しないこと。
//    表示項目があるときは展開クラスを持つこと。
// 5) 画面末尾にGitHubへのリンクを持つフッターが表示されること。
// を確認する。検証環境（ubuntu@192.168.3.240）には、ログイン済みでロケーション一覧を持つベンダー
// （AdGuard VPN）と、未ログインのベンダー（Proton VPN、検証開始時点の選択中ベンダー）の両方が
// 存在するため、ベンダーを切り替えながら両方の状態を確認し、最後に元のベンダーへ戻す。
// 使い方: node e2e/phase22/webgui-phase22.mjs <baseUrl>

import { launch, assert } from "../lib/playwright.mjs";

const baseUrl = process.argv[2] ?? "http://192.168.3.240:8080";
const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1000); // ポーリングの初回取得を待つ

  // --- フッター（GitHubリンク） ---
  const footerLink = page.locator(".app-footer a");
  assert(await footerLink.isVisible(), "フッターにGitHubへのリンクが表示される");
  const href = await footerLink.getAttribute("href");
  assert(href === "https://github.com/nekono-dev/vpngateway-gui", `フッターのリンク先が本リポジトリである（実際: ${href}）`);

  /** 目的: 現在の表示で「アカウント: 未ログイン」相当の文言が無いことを確認する。 */
  async function assertNoUnloggedInText(label) {
    const count = await page.getByText("未ログイン", { exact: false }).count();
    assert(count === 0, `${label}: 「未ログイン」の文言が表示されない（実際: ${count}箇所）`);
  }

  /** 目的: 入力欄（テキストボックス）のスタイルを確認する。 */
  async function assertInputStyle(locator, label) {
    const style = await locator.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { fontSize: computed.fontSize, borderColor: computed.borderColor, padding: computed.padding };
    });
    console.log(`INFO: ${label} style=${JSON.stringify(style)}`);
    const fontSizePx = parseFloat(style.fontSize);
    assert(fontSizePx >= 16, `${label}: 文字サイズが16px以上（実際: ${style.fontSize}）`);
    assert(style.borderColor === "rgb(110, 64, 201)", `${label}: 枠線色が--input-border（実際: ${style.borderColor}）`);
    assert(style.padding !== "6px", `${label}: 従来のpadding(6px)から変更されている（実際: ${style.padding}）`);
  }

  const controls = page.locator("section.controls");

  // --- ベンダー切替のヘルパー ---
  async function switchProvider(name) {
    await page.locator(".provider-option", { hasText: name }).locator('input[type="radio"]').click();
    await page.getByRole("radio", { name, checked: true }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(800); // capabilities等の再取得を待つ
  }

  async function readActiveProvider() {
    return page.evaluate(() => {
      const checked = document.querySelector('.provider-option input[type="radio"]:checked');
      return checked?.closest(".provider-option")?.querySelector("span")?.textContent?.trim();
    });
  }

  const originalProvider = await readActiveProvider();
  console.log(`INFO: 検証開始時のベンダー=${originalProvider}`);

  const providerGroup = page.getByRole("radiogroup", { name: "VPNベンダー" });
  if (!(await providerGroup.isVisible().catch(() => false))) {
    console.log("SKIP: ベンダー選択（有効なベンダーが1つのため、ログイン済み/未ログインの切替確認は省略）");
  } else {
    // --- ログイン済み（AdGuard VPN、ロケーション一覧あり）: バッジ表示・controls-expanded ---
    await switchProvider("AdGuard VPN");
    await assertNoUnloggedInText("AdGuard VPNログイン済み");
    const badge = page.locator(".session-status .badge-ok");
    assert(await badge.isVisible(), "ログイン済み表示がbadge-okで示される");
    assert((await badge.textContent())?.includes("ログイン済み") ?? false, "バッジの文言に「ログイン済み」を含む");
    await page.waitForFunction(() => document.querySelectorAll(".location-item").length > 0, { timeout: 10000 });
    assert(
      (await controls.getAttribute("class"))?.includes("controls-expanded") ?? false,
      "接続先リストに項目があるとき、接続操作カードがcontrols-expandedになる",
    );
    await assertInputStyle(page.getByLabel("接続先を絞り込み"), "接続先の絞り込み欄");

    // --- 未ログイン（Proton VPN、一覧・参考一覧とも空）: controlsが展開しない ---
    await switchProvider("Proton VPN");
    await assertNoUnloggedInText("Proton VPN未ログイン");
    await page.getByLabel("パスワード").waitFor({ state: "visible", timeout: 10000 });
    await assertInputStyle(page.getByLabel("ユーザー名"), "ログインフォームのユーザー名欄");
    await assertInputStyle(page.getByLabel("パスワード"), "ログインフォームのパスワード欄");
    await page.waitForTimeout(500);
    const controlsClass = await controls.getAttribute("class");
    assert(
      !(controlsClass?.includes("controls-expanded") ?? false),
      `表示する接続先が無いとき、接続操作カードがcontrols-expandedにならない（実際のclass: ${controlsClass}）`,
    );

    // 元のベンダーへ戻す（検証環境の状態を変えないため）。
    if (originalProvider && originalProvider !== "Proton VPN") {
      await switchProvider(originalProvider);
    }
  }

  console.log("PASS: Phase22 Web UI（入力欄の視認性・ログイン状態表示・接続操作カードの高さ・フッター）");
} finally {
  await browser.close();
}
