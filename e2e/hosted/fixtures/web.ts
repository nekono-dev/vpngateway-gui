// 責務: UI 試験の共通の仕組み。未処理の例外と JavaScript の error を集め、1 件でもあれば試験を失敗にする（要件 12.x）。

import { test as base, expect, type Page } from "@playwright/test";

/** 試験の中で起きた JavaScript の error（失敗の理由として表示する）。 */
export interface PageErrors {
  readonly messages: string[];
}

/** フィクスチャ: 監視つきの Page と、その中の error の一覧。 */
export const test = base.extend<{ watchedPage: Page; pageErrors: PageErrors }>({
  pageErrors: async ({}, use) => {
    await use({ messages: [] });
  },
  watchedPage: async ({ page, pageErrors }, use) => {
    page.on("pageerror", (error) => pageErrors.messages.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.messages.push(`console.error: ${message.text()}`);
    });
    await use(page);
    // error のイベントは、試験の本体の後に届くことがあるため、少し待ってから集めた一覧を確かめる
    await page.waitForTimeout(200);
    expect(pageErrors.messages, "JavaScript の error が出ている").toEqual([]);
  },
});

export { expect };
