// 責務: Phase24（資格情報入力型ログインもプルダウンの隣へボタン配置・入力欄枠線色の薄色化）の
// Web UI側の実機確認。実ブラウザで
// 1) 資格情報入力型（`loginMethod: "credentials"`）のベンダーでも、未ログイン時にプルダウンと同じ行へ
//    「ログイン」ボタンが表示され、クリックするまでフォームが表示されないこと。
// 2) 「ログイン」ボタンをクリックすると、下の行にログインフォーム（ユーザー名・パスワード等）が表示されること。
// 3) 入力欄・プルダウンの枠線色が、ボタンの枠線色（`--border`）と同程度の薄いグレーになっていること。
// を確認する。検証環境（ubuntu@192.168.3.240）は検証開始時点でProton VPN（資格情報入力型、未ログイン）が
// 選択中であることを前提にする。送信は行わない（実際のログインを試みない）ため、環境の状態は変化しない。
// 使い方: node e2e/phase24/webgui-phase24.mjs <baseUrl>

import { launch, assert } from "../lib/playwright.mjs";

const baseUrl = process.argv[2] ?? "http://192.168.3.240:8080";
const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1000);

  const select = page.getByRole("combobox", { name: "VPNベンダー" });
  assert((await select.inputValue()) === "protonvpn", "検証環境の既定（Proton VPN選択中）である");

  const borderColor = await select.evaluate((el) => getComputedStyle(el).borderColor);
  assert(borderColor === "rgb(208, 215, 222)", `プルダウンの枠線がボタン同等の薄いグレー(--border)である（実際: ${borderColor}）`);
  assert(borderColor !== "rgb(110, 119, 129)", "Phase23時点の濃いグレーではない");
  assert(borderColor !== "rgb(110, 64, 201)", "旧・紫色でもない");

  const providerCard = page.locator("section.provider-card");
  const loginButton = providerCard.getByRole("button", { name: "ログイン" });
  assert((await loginButton.count()) > 0, "資格情報入力型でも「ログイン」ボタンが表示される");

  const rowCheck = await providerCard.evaluate((el) => {
    const selectWrap = el.querySelector(".provider-select-row");
    const action = el.querySelector(".session-action");
    const s = selectWrap.getBoundingClientRect();
    const a = action.getBoundingClientRect();
    return { sameRow: Math.abs(s.top - a.top) < 5 };
  });
  assert(rowCheck.sameRow, "「ログイン」ボタンがプルダウンと同じ行にある");

  assert((await page.getByLabel("パスワード").count()) === 0, "クリック前はログインフォームが表示されない");

  await loginButton.click();
  await page.getByLabel("パスワード").waitFor({ timeout: 5000 });

  const pwBorderColor = await page.getByLabel("パスワード").evaluate((el) => getComputedStyle(el).borderColor);
  assert(pwBorderColor === "rgb(208, 215, 222)", `入力欄の枠線もボタン同等の薄いグレーである（実際: ${pwBorderColor}）`);

  console.log("ALL PASS");
} finally {
  await browser.close();
}
