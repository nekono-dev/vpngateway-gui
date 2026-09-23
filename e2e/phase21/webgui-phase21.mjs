// 責務: Phase21（ダッシュボードのカード構成・レイアウトの整理）のWeb UI側の実機確認。実ブラウザで
// 1) ページ全体が縦にスクロールしないこと（document.documentElement.scrollHeight ===
//    clientHeight）。特に、接続先を選べないプラン（Proton VPN無料版等）でログイン済みのときに
//    表示される「接続できる国（参考）」一覧（国数が多いと内容が伸びやすい）でも、ページ全体は
//    はみ出さないこと（実機で発見した不具合の再現確認）。
// 2) 未ログインのベンダーへ切り替えたとき、「ログインしてください」がDOM上に1箇所しか
//    表示されないこと（制限理由の重複表示の解消）。
// を確認する。既存のログイン状態（ログイン済み/未ログインの両方のベンダー）が無い環境では、
// 該当するベンダーへの切替・ログインを利用者に促して手動確認する。
// 使い方: node e2e/phase21/webgui-phase21.mjs <baseUrl>

import { launch, assert } from "../lib/playwright.mjs";

/** 目的: 現在の表示でページ全体が縦にスクロールしないことを確認する。 */
async function assertFitsViewport(page, label) {
  const info = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  assert(
    info.scrollHeight <= info.clientHeight,
    `${label}: ページ全体がビューポートに収まる（scrollHeight=${info.scrollHeight}, clientHeight=${info.clientHeight}）`,
  );
}

const baseUrl = process.argv[2] ?? "http://192.168.3.240:8080";
const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1000); // ポーリングの初回取得を待つ

  await assertFitsViewport(page, "初期表示");

  // --- 「接続できる国（参考）」一覧（プラン制限で接続先リストが使えないベンダーでログイン済みのときだけ存在する） ---
  const availableGroup = page.getByRole("group", { name: "接続できる国（参考）" });
  if (await availableGroup.isVisible().catch(() => false)) {
    await assertFitsViewport(page, "「接続できる国（参考）」表示時");
    const rowCount = await availableGroup.locator(".location-item").count();
    console.log(`INFO: 参考一覧の行数=${rowCount}`);
  } else {
    console.log("SKIP: 「接続できる国（参考）」一覧（対象のベンダー・プランでログイン済みではないため）");
  }

  // --- 未ログインのベンダーでの「ログインしてください」の重複表示チェック ---
  /** 目的: 各ベンダー選択肢の表示名・選択状態・無効化状態を取得する。 */
  async function readProviderOptions() {
    return page.evaluate(() =>
      [...document.querySelectorAll(".provider-option")].map((label) => ({
        name: label.querySelector("span")?.textContent?.trim() ?? "",
        checked: label.querySelector('input[type="radio"]')?.checked ?? false,
        disabled: label.querySelector('input[type="radio"]')?.disabled ?? false,
      })),
    );
  }

  const providerGroup = page.getByRole("radiogroup", { name: "VPNベンダー" });
  if (await providerGroup.isVisible().catch(() => false)) {
    const before = await readProviderOptions();
    const original = before.find((option) => option.checked);
    const candidate = before.find((option) => !option.checked && !option.disabled);
    if (original && candidate) {
      // 切断中のみ実行する（接続中の切替は確認ダイアログが出て自動化と相性が悪いため、接続中ならスキップする）。
      if (await page.getByRole("button", { name: "切断" }).isVisible().catch(() => false)) {
        console.log("SKIP: 未ログインのベンダーへの切替（接続中は確認ダイアログを伴うため対象外）");
      } else {
        await page.locator(".provider-option", { hasText: candidate.name }).locator('input[type="radio"]').click();
        await page.getByRole("radio", { name: candidate.name, checked: true }).waitFor({ timeout: 10000 });
        await page.waitForTimeout(500); // capabilities等の再取得を待つ
        const loginTexts = await page.getByText("ログインしてください", { exact: true }).count();
        console.log(`INFO: 切替先「${candidate.name}」での「ログインしてください」出現回数=${loginTexts}`);
        assert(loginTexts <= 1, `「ログインしてください」が画面上に重複表示されない（実際: ${loginTexts}箇所）`);
        await assertFitsViewport(page, "ベンダー切替後");

        // 元のベンダーへ戻す（検証環境の状態を変えないため）。
        await page.locator(".provider-option", { hasText: original.name }).locator('input[type="radio"]').click();
        await page.getByRole("radio", { name: original.name, checked: true }).waitFor({ timeout: 10000 });
      }
    } else {
      console.log("SKIP: 未ログインのベンダーへの切替（切替可能なベンダーが無いため）");
    }
  } else {
    console.log("SKIP: ベンダー選択（有効なベンダーが1つのため）");
  }

  console.log("PASS: Phase21 Web UI（画面の縦幅・制限理由の重複表示）");
} finally {
  await browser.close();
}
