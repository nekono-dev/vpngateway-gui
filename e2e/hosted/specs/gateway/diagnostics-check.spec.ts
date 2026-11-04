// 責務: 失敗時の成果物と診断の確認（3.2）。E2E_INTENTIONAL_FAILURE=1 のときだけ、意図的に失敗させる。
// 通常の実行では何もしない（skip）。確認の実行（workflow の intentional_failure）で、診断（スクリーンショット・
// トレース・経路と nft の診断）が成果物に集まることを確かめるために使う。

import { test, expect } from "../../fixtures/web";

test.describe("失敗時の成果物と診断（gateway）", () => {
  test.skip(process.env.E2E_INTENTIONAL_FAILURE !== "1", "確認の実行のときだけ、意図的に失敗させる");

  test("3.2: 意図的な失敗で、スクリーンショット・トレース・診断が成果物に集まる", async ({ watchedPage: page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "この見出しは存在しない（意図的な失敗）" })).toBeVisible({ timeout: 2000 });
  });
});
