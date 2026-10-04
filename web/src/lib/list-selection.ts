// 責務: 並んだ項目（IDの配列）に対する、選択範囲・追加位置・削除後の選択先・並べ替えの計算。
// DOMや項目の中身に依存せず、IDの配列と選択集合だけで完結する（行リストエディタが使う）。

/**
 * アンカーから指定の項目までの範囲（両端を含む）を、並び順のIDの配列で返す。
 * アンカーが無い（または並びに無い）ときは、指定の項目だけを返す。
 *
 * 例: selectRange(["a", "b", "c", "d"], "d", "b") // => ["b", "c", "d"]
 */
export function selectRange(ids: string[], anchor: string | undefined, to: string): string[] {
  const toIndex = ids.indexOf(to);
  if (toIndex < 0) return [];
  const anchorIndex = anchor === undefined ? -1 : ids.indexOf(anchor);
  if (anchorIndex < 0) return [to];
  return ids.slice(Math.min(anchorIndex, toIndex), Math.max(anchorIndex, toIndex) + 1);
}

/**
 * 新しい項目を挿入する位置を返す。選択中の項目のうち最も下のものの直後、選択が無ければ先頭。
 *
 * 例: insertionIndex(["a", "b", "c"], new Set(["a", "b"])) // => 2
 */
export function insertionIndex(ids: string[], selected: ReadonlySet<string>): number {
  let last = -1;
  ids.forEach((id, index) => {
    if (selected.has(id)) last = index;
  });
  return last + 1;
}

/**
 * 項目を削除した後に選択する項目を返す。削除した最上の位置にある項目（無ければ直前の項目）。残りが無ければundefined。
 *
 * 例: selectionAfterRemoval(["a", "b", "c"], new Set(["b"])) // => "c"
 */
export function selectionAfterRemoval(ids: string[], removed: ReadonlySet<string>): string | undefined {
  const first = ids.findIndex((id) => removed.has(id));
  const rest = ids.filter((id) => !removed.has(id));
  if (first < 0) return undefined;
  return rest[Math.min(first, rest.length - 1)];
}

/**
 * 移動する項目（並び順は保つ）を、対象の項目の直前（after=false）または直後（after=true）へ移した並びを返す。
 * 対象が移動する項目の中にあるときは、並びを変えない。
 *
 * 例: moveItems(["a", "b", "c", "d"], new Set(["a", "b"]), "d", true) // => ["c", "d", "a", "b"]
 */
export function moveItems(ids: string[], moving: ReadonlySet<string>, targetId: string, after: boolean): string[] {
  if (moving.has(targetId) || !ids.includes(targetId)) return ids;
  const moved = ids.filter((id) => moving.has(id));
  const rest = ids.filter((id) => !moving.has(id));
  const at = rest.indexOf(targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/**
 * カーソル（最後に操作した項目）を上下へ動かした先の項目を返す。端では動かない。カーソルが無いときは、下へなら先頭、上へなら先頭。
 *
 * 例: moveCursor(["a", "b", "c"], "a", 1) // => "b"
 */
export function moveCursor(ids: string[], cursor: string | undefined, delta: 1 | -1): string | undefined {
  if (ids.length === 0) return undefined;
  const index = cursor === undefined ? -1 : ids.indexOf(cursor);
  if (index < 0) return ids[0];
  return ids[Math.min(Math.max(index + delta, 0), ids.length - 1)];
}
