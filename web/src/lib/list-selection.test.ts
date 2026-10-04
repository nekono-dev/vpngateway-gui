// 責務: list-selection（選択範囲・追加位置・削除後の選択先・並べ替え）のテスト。

import { describe, expect, it } from "vitest";
import { insertionIndex, moveCursor, moveItems, selectRange, selectionAfterRemoval } from "./list-selection";

const IDS = ["a", "b", "c", "d"];

describe("selectRange", () => {
  it("アンカーから指定の項目まで（両端を含む）を並び順で返す。逆向きでも同じ", () => {
    expect(selectRange(IDS, "b", "d")).toEqual(["b", "c", "d"]);
    expect(selectRange(IDS, "d", "b")).toEqual(["b", "c", "d"]);
  });
  it("アンカーが無い・並びに無いときは指定の項目だけを返す", () => {
    expect(selectRange(IDS, undefined, "c")).toEqual(["c"]);
    expect(selectRange(IDS, "x", "c")).toEqual(["c"]);
  });
});

describe("insertionIndex", () => {
  it("選択中の最も下の項目の直後を返す（離れた複数選択でも最下行）", () => {
    expect(insertionIndex(IDS, new Set(["a"]))).toBe(1);
    expect(insertionIndex(IDS, new Set(["a", "c"]))).toBe(3);
    expect(insertionIndex(IDS, new Set(["d"]))).toBe(4);
  });
  it("選択が無ければ先頭（0）を返す", () => {
    expect(insertionIndex(IDS, new Set())).toBe(0);
    expect(insertionIndex([], new Set())).toBe(0);
  });
});

describe("selectionAfterRemoval", () => {
  it("削除した最上の位置にあった項目（今は次の項目）を返す", () => {
    expect(selectionAfterRemoval(IDS, new Set(["b", "c"]))).toBe("d");
  });
  it("末尾を削除したときは直前の項目、全部削除したときはundefinedを返す", () => {
    expect(selectionAfterRemoval(IDS, new Set(["d"]))).toBe("c");
    expect(selectionAfterRemoval(IDS, new Set(IDS))).toBeUndefined();
  });
});

describe("moveItems", () => {
  it("複数の項目を相対順序を保ったまま対象の直後へ移す", () => {
    expect(moveItems(IDS, new Set(["a", "b"]), "d", true)).toEqual(["c", "d", "a", "b"]);
  });
  it("対象の直前へ移す", () => {
    expect(moveItems(IDS, new Set(["d"]), "b", false)).toEqual(["a", "d", "b", "c"]);
  });
  it("対象が移動する項目の中にあるときは並びを変えない", () => {
    expect(moveItems(IDS, new Set(["b", "c"]), "c", true)).toEqual(IDS);
  });
});

describe("moveCursor", () => {
  it("上下へ動かし、端では止まる", () => {
    expect(moveCursor(IDS, "b", 1)).toBe("c");
    expect(moveCursor(IDS, "a", -1)).toBe("a");
    expect(moveCursor(IDS, "d", 1)).toBe("d");
  });
  it("カーソルが無ければ先頭、空なら undefined を返す", () => {
    expect(moveCursor(IDS, undefined, 1)).toBe("a");
    expect(moveCursor([], undefined, 1)).toBeUndefined();
  });
});
