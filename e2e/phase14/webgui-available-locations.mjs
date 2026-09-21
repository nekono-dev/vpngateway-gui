// 責務: Phase 14（プランで接続できる接続先の参考表示）を、実機のWeb UIでPlaywrightにより確認する。
// 実行: node e2e/phase14/webgui-available-locations.mjs <baseUrl>
// 前提: 接続先を選べないプラン（無料プラン等）でログイン済みのベンダーが選択中であること（人手のログインが要る。実機Proton VPN無料アカウント）。
// 確認: 接続先リストが制限されている理由文の下に、「接続できる国（参考）」の一覧が出る。操作できる要素（ボタン・入力）を含まない。
//       出力の国・都市は、APIの`GET /v1/connection/available-locations`の値と一致する。

import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl] = process.argv.slice(2);
const { browser, page } = await launch(baseUrl);
try {
  const api = await (await fetch(`${baseUrl}/api/v1/connection/available-locations`)).json();
  assert(api.locations.length > 0, "APIが参考一覧（1件以上）を返す");

  await page.goto("/");
  const group = page.getByRole("group", { name: "接続できる国（参考）" });
  await group.waitFor({ timeout: 20000 });
  assert(true, "「接続できる国（参考）」の一覧が表示される");
  assert((await group.locator("li").count()) === api.locations.length, "表示された国の数がAPIの値と一致する");
  const first = api.locations[0];
  assert((await group.locator("li").first().innerText()).includes(first.name), `先頭の国（${first.name}）が表示される`);
  assert((await group.locator("li").first().innerText()).includes(first.cities[0]), `先頭の国の都市（${first.cities[0]}）が表示される`);
  assert((await group.locator("button, input, select, a").count()) === 0, "一覧は操作できない要素（ボタン・入力・リンク）を含まない");
  assert((await page.getByText("自動接続で、次のいずれかの国のサーバに接続されます").count()) === 1, "自動接続であること・選択できないことの説明が出る");
} finally {
  await browser.close();
}
