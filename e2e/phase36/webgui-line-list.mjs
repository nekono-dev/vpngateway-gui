// 責務: Phase 36（行リストエディタ）を実ブラウザ（Playwright）で検証する。
// 実行: node e2e/phase36/webgui-line-list.mjs <baseUrl>
// 確認内容: 選択（単独・Ctrl・Shift）、2回目のクリックでの編集、追加位置（選択行の最下行の直後・選択なしは先頭）、
//          空欄の自動削除、削除、ドラッグ並べ替え、見た目（枠線色・選択行の背景）。設定は保存しない。

import { launch, assert } from "../lib/playwright.mjs";
import { getListItems, listbox, setListItems } from "../lib/line-list.mjs";

const [baseUrl] = process.argv.slice(2);
const { browser, page } = await launch(baseUrl);
const NAME = /迂回ドメイン（split-tunnel/;

try {
  await page.goto("/");
  await page.locator("strong.connection-label").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定" });
  await dialog.getByRole("tab", { name: "通信制御" }).waitFor();
  const list = listbox(dialog, NAME);
  const rows = list.getByRole("option");
  const items = () => getListItems(dialog, NAME);
  const selected = async () =>
    list.getByRole("option", { selected: true }).getByRole("textbox").evaluateAll((els) => els.map((el) => el.value));
  const frame = list.locator("xpath=ancestor::*[contains(@class,'line-list-frame')]");

  await setListItems(dialog, NAME, ["a.example", "b.example", "c.example", "d.example"]);
  assert((await items()).join() === "a.example,b.example,c.example,d.example", "［追加］で順に入力した項目が並ぶ");
  assert(!(await rows.first().getByRole("textbox").isEditable()), "編集中でない行のテキストボックスは編集できない");

  await rows.nth(1).click();
  assert((await selected()).join() === "b.example", "1回目のクリックで行を選択する");
  assert(!(await rows.nth(1).getByRole("textbox").isEditable()), "1回目のクリックでは編集に入らない");
  await rows.nth(1).click();
  assert(await rows.nth(1).getByRole("textbox").isEditable(), "選択中の行の2回目のクリックで編集に入る");
  await page.keyboard.type("-edited");
  await page.keyboard.press("Enter");
  assert((await items())[1] === "b.example-edited", "編集して Enter で確定できる");

  await rows.nth(0).click();
  await rows.nth(2).click({ modifiers: ["Control"] });
  assert((await selected()).join() === "a.example,c.example", "Ctrl+クリックで選択を追加できる");
  await rows.nth(3).click({ modifiers: ["Shift"] });
  assert((await selected()).join() === "c.example,d.example", "Shift+クリックで、直前に操作した行（アンカー）からの範囲を選択できる");

  await rows.nth(0).click();
  await rows.nth(2).click({ modifiers: ["Control"] });
  await frame.getByRole("button", { name: /追加/ }).click();
  await page.keyboard.type("new.example");
  await page.keyboard.press("Enter");
  assert((await items()).join() === "a.example,b.example-edited,c.example,new.example,d.example", "選択行のうち最も下の行の直下に追加される");

  await list.focus();
  await page.keyboard.press("Delete");
  assert((await items()).join() === "a.example,b.example-edited,c.example,d.example", "Delete で選択行を削除できる");
  await rows.nth(0).click();
  await rows.nth(0).click({ modifiers: ["Control"] });
  assert((await selected()).length === 0, "Ctrl+クリックで選択を解除でき、選択なしにできる");
  await frame.getByRole("button", { name: /追加/ }).click();
  await page.keyboard.type("top.example");
  await page.keyboard.press("Enter");
  assert((await items())[0] === "top.example", "選択がないときは先頭に追加される");

  await frame.getByRole("button", { name: /追加/ }).click();
  await page.keyboard.press("Enter");
  assert((await items()).length === 5, "空のまま確定した行は自動で削除される");

  await rows.nth(0).locator(".line-list-grip").dragTo(rows.nth(2), { targetPosition: { x: 40, y: 20 } });
  assert((await items()).join() === "a.example,b.example-edited,top.example,c.example,d.example", "掴み部のドラッグで行を並べ替えできる");

  await rows.nth(0).click();
  const bg = await rows.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor);
  const border = await frame.evaluate((el) => getComputedStyle(el).borderTopColor);
  assert(bg === "rgb(221, 244, 255)", `選択行の背景が接続先リストの選択行と同じ（${bg}）`);
  assert(border === "rgb(208, 215, 222)", `枠線色が入力欄と同じ（${border}）`);
  await page.screenshot({ path: "/tmp/phase36-line-list.png" });

  await page.setViewportSize({ width: 360, height: 700 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert(!overflow, "スマートフォン幅でもページが横にスクロールしない");
  await page.screenshot({ path: "/tmp/phase36-line-list-narrow.png" });
  await dialog.getByRole("button", { name: "キャンセル" }).click();
} finally {
  await browser.close();
}
