// 責務: Phase16（起動時の接続復元・切断ボタンの配置改善・参考一覧での現在の接続先表示）の
// Web UI側の実機確認。接続中のProton VPN（無料プラン）に対し、実ブラウザで
// 1) 切断ボタンの配置（画面上部・アカウント状態表示の隣）と配色（赤系）、
// 2) 参考一覧が接続先リストと同じ行形式になり、現在の接続先（Seattle）に「接続中」バッジが付くこと、
//    ping列が出ないこと、選択・お気に入りができないこと
// を確認する。
// 使い方: node e2e/phase16/webgui-phase16.mjs <baseUrl>

import { launch, assert } from "../lib/playwright.mjs";

const baseUrl = process.argv[2] ?? "http://192.168.3.240:8080";
const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");

  // --- 切断ボタンの配置・強調（Phase 16） ---
  const disconnectButton = page.getByRole("button", { name: "切断" });
  await disconnectButton.waitFor({ state: "visible", timeout: 15000 });

  // アカウント状態（"アカウント: ログイン済み..."）と同じ行（session-top-row）にあることを確認する。
  const sameRow = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "切断");
    const row = btn?.closest(".session-top-row");
    return row !== null && row !== undefined;
  });
  assert(sameRow, "切断ボタんがsession-top-row（アカウント状態表示と同じ行）にある");

  // 接続操作カードの末尾（connect-row内）には無いことも確認する（配置が変わったことの裏取り）。
  const notInConnectRow = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".connect-row button")].find((b) => b.textContent?.trim() === "切断");
    return btn === undefined;
  });
  assert(notInConnectRow, "切断ボタンは.connect-row（接続/接続先を変更の並び）には無い");

  const bg = await disconnectButton.evaluate((el) => getComputedStyle(el).backgroundColor);
  assert(bg === "rgb(207, 34, 46)", `切断ボタンの背景色が赤系（--danger）である（実際: ${bg}）`);

  // --- 参考一覧での現在の接続先の表示（Phase 16） ---
  const group = page.getByRole("group", { name: "接続できる国（参考）" });
  await group.waitFor({ state: "visible", timeout: 15000 });
  const groupText = await group.innerText();
  assert(groupText.includes("選択はできません"), "参考一覧に選択できない旨の説明がある");
  assert(groupText.includes("Seattle"), "現在接続中の都市名（Seattle）が表示される");
  assert(groupText.includes("接続中"), "「接続中」バッジが表示される");

  const pingColumnCount = await group.locator(".location-ping").count();
  assert(pingColumnCount === 0, "Proton VPNはping非対応のため、ping列が出ない");

  const interactiveCount = await group.locator("input, a").count();
  assert(interactiveCount === 0, "参考一覧には選択用のinput/aが無い（選択を無効化）");

  const enabledButtons = await group.locator("button:not([disabled])").count();
  assert(enabledButtons === 0, "参考一覧の★ボタンはすべて無効化されている");

  console.log("PASS: Phase16 Web UI（切断ボタンの配置・強調、参考一覧での現在の接続先の表示）");
} finally {
  await browser.close();
}
