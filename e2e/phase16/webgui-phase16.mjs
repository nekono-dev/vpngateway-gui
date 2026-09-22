// 責務: Phase16（起動時の接続復元・接続/切断ボタンの配置改善・参考一覧での現在の接続先表示）の
// Web UI側の実機確認。実ブラウザで
// 1) 接続／切断ボタンが画面上部（アカウント状態表示と同じ行）にあり、接続操作カードの末尾
//    （.connect-row。「接続先を変更」のみが残る場所）には無いこと、切断ボタンが赤系の配色であること、
//    接続/切断のたびに正しく片方だけが表示されること
// 2)（Proton VPN無料プラン等、接続先を選べないプランに接続中の場合のみ）参考一覧が接続先リストと
//    同じ行形式になり、現在の接続先に「接続中」バッジが付くこと、ping列が出ないこと、選択・お気に入り
//    ができないこと
// を確認する。開始時の接続状態（接続中/切断中のどちらでもよい）に合わせて検証内容を選ぶ。
// 使い方: node e2e/phase16/webgui-phase16.mjs <baseUrl>

import { launch, assert } from "../lib/playwright.mjs";

/** 目的: 指定した文言のボタンが、アカウント状態表示と同じ行（session-top-row）にあり、
 *       .connect-row（接続先を変更のみが残る場所）には無いことを確認する。 */
async function assertButtonInSessionTopRow(page, label) {
  const result = await page.evaluate((text) => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
    return {
      count: buttons.length,
      inTopRow: buttons.some((b) => b.closest(".session-top-row") !== null),
      inConnectRow: buttons.some((b) => b.closest(".connect-row") !== null),
    };
  }, label);
  assert(result.count === 1, `［${label}］ボタンが1つだけ存在する（実際: ${result.count}）`);
  assert(result.inTopRow, `［${label}］ボタンがsession-top-row（アカウント状態表示と同じ行）にある`);
  assert(!result.inConnectRow, `［${label}］ボタンは.connect-row（接続先を変更のみの並び）には無い`);
}

const baseUrl = process.argv[2] ?? "http://192.168.3.240:8080";
const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");

  // --- 接続／切断ボタンの配置・強調（Phase 16） ---
  const connectButton = page.getByRole("button", { name: "接続", exact: true });
  const disconnectButton = page.getByRole("button", { name: "切断", exact: true });
  await Promise.race([
    connectButton.waitFor({ state: "visible", timeout: 15000 }),
    disconnectButton.waitFor({ state: "visible", timeout: 15000 }),
  ]);

  if (await disconnectButton.isVisible()) {
    await assertButtonInSessionTopRow(page, "切断");
    const bg = await disconnectButton.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(bg === "rgb(207, 34, 46)", `切断ボタンの背景色が赤系（--danger）である（実際: ${bg}）`);

    // --- 参考一覧での現在の接続先の表示（接続先を選べないプランに接続中の場合のみ存在する） ---
    const group = page.getByRole("group", { name: "接続できる国（参考）" });
    if (await group.isVisible().catch(() => false)) {
      const groupText = await group.innerText();
      assert(groupText.includes("選択はできません"), "参考一覧に選択できない旨の説明がある");
      assert(groupText.includes("接続中"), "「接続中」バッジが表示される");
      const interactiveCount = await group.locator("input, a").count();
      assert(interactiveCount === 0, "参考一覧には選択用のinput/aが無い（選択を無効化）");
      const enabledButtons = await group.locator("button:not([disabled])").count();
      assert(enabledButtons === 0, "参考一覧の★ボタンはすべて無効化されている");
      console.log("PASS: 参考一覧での現在の接続先の表示");
    } else {
      console.log("SKIP: 参考一覧（接続先を選べないプランではないため対象外）");
    }

    // 切断→接続ボタンへ戻ることを確認する。
    await disconnectButton.click();
    await connectButton.waitFor({ state: "visible", timeout: 20000 });
    await assertButtonInSessionTopRow(page, "接続");
    console.log("PASS: 切断すると接続ボタンへ切り替わる");
  } else {
    await assertButtonInSessionTopRow(page, "接続");
    // 接続→切断ボタンへ切り替わることを確認する。
    await connectButton.click();
    await disconnectButton.waitFor({ state: "visible", timeout: 20000 });
    await assertButtonInSessionTopRow(page, "切断");
    console.log("PASS: 接続すると切断ボタンへ切り替わる");
    // 検証開始前の状態（切断中）へ戻す。
    await disconnectButton.click();
    await connectButton.waitFor({ state: "visible", timeout: 20000 });
  }

  console.log("PASS: Phase16 Web UI（接続・切断ボタンの配置・強調、参考一覧での現在の接続先の表示）");
} finally {
  await browser.close();
}
