// 責務: E2Eで行リストエディタ（設定ダイアログの「1行に1値」入力。Phase 36）を操作・読み取るヘルパー。
//
// 使用例: await setListItems(dialog, /明示的プロキシの許可CIDR/, ["192.168.3.0/24"]);

/** 見出し（名前）で行リストエディタ（role=listbox）を特定する。 */
export function listbox(scope, name) {
  return scope.getByRole("listbox", { name });
}

/** 行リストエディタの全項目のテキストを、並び順の配列で返す。 */
export async function getListItems(scope, name) {
  return listbox(scope, name).getByRole("textbox").evaluateAll((els) => els.map((el) => el.value));
}

/** 行リストエディタが無効（編集できない状態）かを返す。 */
export async function isListDisabled(scope, name) {
  return (await listbox(scope, name).getAttribute("aria-disabled")) === "true";
}

/**
 * 行リストエディタの内容を、指定の項目だけにする。全項目を削除してから、［追加］で順に入力する
 * （選択がないときは先頭、選択中の行の下へ追加されるため、順に追加すると指定の並びになる）。
 */
export async function setListItems(scope, name, items) {
  const list = listbox(scope, name);
  if ((await list.getByRole("option").count()) > 0) {
    await list.focus();
    await scope.page().keyboard.press("Control+a");
    await scope.page().keyboard.press("Delete");
  }
  const frame = list.locator("xpath=ancestor::*[contains(@class,'line-list-frame')]");
  for (const item of items) {
    await frame.getByRole("button", { name: /追加/ }).click();
    await scope.page().keyboard.type(item);
    await scope.page().keyboard.press("Enter");
  }
}
