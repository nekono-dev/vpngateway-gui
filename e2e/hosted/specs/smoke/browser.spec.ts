// 責務: 基盤の確認（e2e-tests 1.12）。空の試験が headless Chromium で起動することを確かめる。
// 群の試験（lifecycle・stack・gateway）は、2.x 以降で追加する。

import { test, expect } from "../../fixtures/web";

test("headless Chromium が起動し、空のページを開ける", async ({ watchedPage }) => {
  await watchedPage.goto("about:blank");
  await expect(watchedPage).toHaveURL("about:blank");
});
