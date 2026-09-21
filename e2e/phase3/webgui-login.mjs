// 責務: Web UIの「VPNベンダーへログイン」ボタンを押し、認証URLが画面に表示されることを検証する
// （Phase 2で実装済みのログイン導線を、Phase 3検証環境（LXC上のdocker compose）で再確認する）。
// 認証完了そのものはブラウザでの人手操作が必要なため、URLを標準出力へ出して終了する。
// 実行: node e2e/phase3/webgui-login.mjs http://<ゲートウェイのIP>:8080

import { launch, assert } from "../lib/playwright.mjs";

const baseUrl = process.argv[2];
const { browser, page } = await launch(baseUrl);
try {
  await page.goto("/");
  // 未ログイン状態では接続状態の取得が422となりエラーカードが出る想定
  await page.getByRole("button", { name: "VPNベンダーへログイン" }).click();
  const link = page.getByRole("link", { name: "ログインURLを開く" });
  await link.waitFor({ timeout: 30000 });
  const loginUrl = await link.getAttribute("href");
  assert(/^https:\/\/auth\.adguard\.io\//.test(loginUrl ?? ""), "認証URLが画面に表示される");
  console.log(`LOGIN_URL=${loginUrl}`);
} finally {
  await browser.close();
}
