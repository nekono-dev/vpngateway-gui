// 責務: UI 試験の共通の仕組み。未処理の例外と JavaScript の error を集め、1 件でもあれば試験を失敗にする（要件 12.x）。
// 試験が意図して起こす error（誤った資格情報の 401 など）は、allow で明示した場合だけ除く。

import { test as base, expect, type Page } from "@playwright/test";

/** 試験の中で起きた JavaScript の error（失敗の理由として表示する）。 */
export interface PageErrors {
  readonly messages: string[];
  readonly allowed: RegExp[];
  /** 意図した error を許す（例: 誤った資格情報で 401 が返ることの確認）。 */
  allow(pattern: RegExp): void;
}

/** フィクスチャ: 監視つきの Page と、その中の error の一覧。 */
export const test = base.extend<{ watchedPage: Page; pageErrors: PageErrors }>({
  pageErrors: async ({}, use) => {
    const allowed: RegExp[] = [];
    await use({
      messages: [],
      allowed,
      allow: (pattern) => {
        allowed.push(pattern);
      },
    });
  },
  watchedPage: async ({ page, pageErrors }, use) => {
    page.on("pageerror", (error) => pageErrors.messages.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      // 発生元の URL を添える（失敗の原因を、成果物の結果から特定できるように）
      if (message.type() === "error") pageErrors.messages.push(`console.error: ${message.text()} (${message.location().url})`);
    });
    await use(page);
    // error のイベントは、試験の本体の後に届くことがあるため、少し待ってから集めた一覧を確かめる
    await page.waitForTimeout(200);
    const unexpected = pageErrors.messages.filter((m) => !pageErrors.allowed.some((p) => p.test(m)));
    expect(unexpected, "JavaScript の error が出ている").toEqual([]);
  },
});

export { expect };
