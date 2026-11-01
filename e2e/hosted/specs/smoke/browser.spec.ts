// 責務: 基盤の確認（e2e-tests 1.12）。空の試験が headless Chromium で起動することを確かめる。
// 群の試験（lifecycle・stack・gateway）は、2.x 以降で追加する。

import { test, expect } from "../../fixtures/web";

test("headless Chromium が起動し、空のページを開ける", async ({ watchedPage }) => {
  await watchedPage.goto("about:blank");
  await expect(watchedPage).toHaveURL("about:blank");
});

// 確認: JavaScript の error が出た試験は失敗になる（fixtures/web.ts の仕組み）。
// test.fail は、中で失敗することを期待する。error を監視している仕組みが効いていれば、この試験は期待どおり失敗する。
test.fail("JavaScript の error が出ると、試験は失敗になる", async ({ watchedPage }) => {
  await watchedPage.setContent("<script>throw new Error('確認用の error');</script>");
});
