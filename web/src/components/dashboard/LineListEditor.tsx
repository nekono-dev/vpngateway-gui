// 責務: 「1行に1値」の入力を文字列配列として編集するための汎用UI部品（行リストエディタ）。
// テキストボックスを縦に並べたリストで、追加・削除・複数選択・並べ替えができる。
// `excludedDomains`・`explicitProxyAllowedCidrs`など、値の妥当性検証は持たず表示・編集のみを行う
// （webserver/requirements.md「行リストエディタ（Phase 36）」、design.md「行リストエディタの実装方針」参照。
// 保存時の前後の空白・空行の除去は呼び出し元が行う）。

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  insertionIndex,
  moveCursor,
  moveItems,
  selectRange,
  selectionAfterRemoval,
} from "../../lib/list-selection";

interface Props {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  // 各行が空のときに薄く表示する入力例。
  placeholder?: string;
  // 項目数の上限。上限に達したら［追加］を押せなくする。
  maxItems?: number;
}

interface Row {
  id: string;
  text: string;
}

interface DropTarget {
  id: string;
  after: boolean;
}

let rowSequence = 0;
function toRows(texts: string[]): Row[] {
  return texts.map((text) => ({ id: `row-${++rowSequence}`, text }));
}

function sameTexts(rows: Row[], texts: string[]): boolean {
  return rows.length === texts.length && rows.every((row, index) => row.text === texts[index]);
}

export function LineListEditor({ label, value, onChange, disabled, placeholder, maxItems }: Props) {
  const labelId = useId();
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string>();
  const [grabId, setGrabId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  // 編集中の行のID。blurとEnterの二重確定を防ぐため、stateとは別にref（同期的に更新する）でも持つ。
  const editingRef = useRef<string>();
  const originalTextRef = useRef("");
  // 直前のmousedownで「すでに単独で選択済みの行」を押したときの行ID（clickで編集を始める印）。
  const armedRef = useRef<string>();
  const anchorRef = useRef<string>();
  const cursorRef = useRef<string>();

  // 外部の値が自分の出力と異なるとき（設定の読み込み等）だけ、行を作り直す。
  useEffect(() => {
    if (sameTexts(rows, value)) return;
    setRows(toRows(value));
    setSelected(new Set());
    setEditingId(undefined);
    editingRef.current = undefined;
    // rowsは自分の更新で変わるため依存に含めない（含めると自分の更新のたびに作り直しの判定が走る）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (editingId === undefined) return;
    const input = inputRefs.current.get(editingId);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollIntoView?.({ block: "nearest" });
  }, [editingId]);

  function applyRows(next: Row[]): void {
    setRows(next);
    onChange(next.map((row) => row.text));
  }

  function startEdit(id: string): void {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return;
    originalTextRef.current = row.text;
    editingRef.current = id;
    setEditingId(id);
  }

  function endEdit(): void {
    editingRef.current = undefined;
    setEditingId(undefined);
  }

  // 編集を確定する。前後の空白を除き、空なら行ごと削除する。
  function commitEdit(): void {
    const id = editingRef.current;
    if (id === undefined) return;
    endEdit();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return;
    const text = row.text.trim();
    if (text === "") {
      applyRows(rows.filter((candidate) => candidate.id !== id));
      setSelected((current) => new Set([...current].filter((selectedId) => selectedId !== id)));
    } else if (text !== row.text) {
      applyRows(rows.map((candidate) => (candidate.id === id ? { ...candidate, text } : candidate)));
    }
  }

  function cancelEdit(): void {
    const id = editingRef.current;
    if (id === undefined) return;
    endEdit();
    if (originalTextRef.current === "") {
      applyRows(rows.filter((candidate) => candidate.id !== id));
      setSelected(new Set());
    } else {
      applyRows(rows.map((candidate) => (candidate.id === id ? { ...candidate, text: originalTextRef.current } : candidate)));
    }
    listRef.current?.focus({ preventScroll: true });
  }

  const isFull = maxItems !== undefined && rows.length >= maxItems;

  function addRow(): void {
    if (disabled || isFull) return;
    const ids = rows.map((row) => row.id);
    const index = insertionIndex(ids, selected);
    const added: Row = { id: `row-${++rowSequence}`, text: "" };
    applyRows([...rows.slice(0, index), added, ...rows.slice(index)]);
    setSelected(new Set([added.id]));
    anchorRef.current = added.id;
    cursorRef.current = added.id;
    originalTextRef.current = "";
    editingRef.current = added.id;
    setEditingId(added.id);
  }

  function removeSelected(): void {
    if (disabled || selected.size === 0) return;
    const ids = rows.map((row) => row.id);
    const nextId = selectionAfterRemoval(ids, selected);
    applyRows(rows.filter((row) => !selected.has(row.id)));
    setSelected(nextId === undefined ? new Set() : new Set([nextId]));
    anchorRef.current = nextId;
    cursorRef.current = nextId;
  }

  // 選択はmousedownで確定する（clickで確定すると、選択済みの行の2回目のクリックと区別できないため）。
  function handleRowMouseDown(event: MouseEvent, id: string): void {
    if (disabled || editingRef.current === id) return;
    if (editingRef.current !== undefined) commitEdit();
    armedRef.current = undefined;
    const ids = rows.map((row) => row.id);
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      anchorRef.current = id;
    } else if (event.shiftKey) {
      setSelected(new Set(selectRange(ids, anchorRef.current, id)));
      // Shift+クリックでブラウザがテキストを範囲選択しないようにする。
      event.preventDefault();
    } else {
      if (selected.size === 1 && selected.has(id)) armedRef.current = id;
      else setSelected(new Set([id]));
      anchorRef.current = id;
    }
    cursorRef.current = id;
  }

  function handleRowClick(event: MouseEvent, id: string): void {
    if (disabled) return;
    const onGrip = (event.target as HTMLElement).closest(".line-list-grip") !== null;
    if (armedRef.current === id && !onGrip && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      armedRef.current = undefined;
      startEdit(id);
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled || event.target !== event.currentTarget || editingRef.current !== undefined) return;
    const ids = rows.map((row) => row.id);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = moveCursor(ids, cursorRef.current, event.key === "ArrowDown" ? 1 : -1);
      if (next === undefined) return;
      if (event.shiftKey) {
        anchorRef.current ??= cursorRef.current ?? next;
        setSelected(new Set(selectRange(ids, anchorRef.current, next)));
      } else {
        setSelected(new Set([next]));
        anchorRef.current = next;
      }
      cursorRef.current = next;
      inputRefs.current.get(next)?.scrollIntoView?.({ block: "nearest" });
    } else if ((event.key === "a" || event.key === "A") && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      setSelected(new Set(ids));
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      const first = ids.find((id) => selected.has(id));
      if (first !== undefined) startEdit(first);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    }
  }

  function handleDragStart(event: React.DragEvent, id: string): void {
    const moving = selected.has(id) ? selected : new Set([id]);
    if (!selected.has(id)) setSelected(moving);
    setDraggingIds(moving);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "line-list");
  }

  function handleDragOver(event: React.DragEvent, id: string): void {
    if (draggingIds.size === 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    if (dropTarget?.id !== id || dropTarget.after !== after) setDropTarget({ id, after });
  }

  function handleDrop(event: React.DragEvent, id: string): void {
    if (draggingIds.size === 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    const order = moveItems(
      rows.map((row) => row.id),
      draggingIds,
      id,
      after,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    applyRows(order.map((orderedId) => byId.get(orderedId) as Row));
    finishDrag();
  }

  function finishDrag(): void {
    setDraggingIds(new Set());
    setDropTarget(undefined);
    setGrabId(undefined);
  }

  const countText =
    maxItems !== undefined
      ? `${rows.length} / ${maxItems}件`
      : `${rows.length}件${selected.size > 0 ? `（${selected.size}件選択中）` : ""}`;

  return (
    <div className="line-list-field">
      <span id={labelId}>{label}</span>
      <div className="line-list-frame" aria-disabled={disabled ? "true" : undefined}>
        <div className="line-list-head">
          <span className="line-list-count">{countText}</span>
          <span className="line-list-buttons">
            <button type="button" disabled={disabled || isFull} onClick={addRow}>
              ＋ 追加
            </button>
            <button type="button" className="danger" disabled={disabled || selected.size === 0} onClick={removeSelected}>
              {selected.size > 1 ? `削除（${selected.size}件）` : "削除"}
            </button>
          </span>
        </div>
        <div
          ref={listRef}
          className="line-list"
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelId}
          aria-disabled={disabled ? "true" : undefined}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={handleListKeyDown}
        >
          {rows.length === 0 ? <div className="line-list-empty">項目がありません。［追加］で入力できます。</div> : null}
          {rows.map((row) => {
            const isEditing = editingId === row.id;
            const classNames = ["line-list-row"];
            if (isEditing) classNames.push("line-list-editing");
            if (selected.has(row.id)) classNames.push("line-list-selected");
            if (draggingIds.has(row.id)) classNames.push("line-list-dragging");
            if (dropTarget?.id === row.id) classNames.push(dropTarget.after ? "line-list-drop-after" : "line-list-drop-before");
            return (
              <div
                key={row.id}
                role="option"
                aria-selected={selected.has(row.id)}
                className={classNames.join(" ")}
                draggable={!disabled && !isEditing && grabId === row.id}
                onMouseDown={(event) => handleRowMouseDown(event, row.id)}
                onClick={(event) => handleRowClick(event, row.id)}
                onDragStart={(event) => handleDragStart(event, row.id)}
                onDragOver={(event) => handleDragOver(event, row.id)}
                onDragLeave={() => setDropTarget(undefined)}
                onDrop={(event) => handleDrop(event, row.id)}
                onDragEnd={finishDrag}
              >
                <span
                  className="line-list-grip"
                  aria-hidden="true"
                  onMouseDown={() => !isEditing && !disabled && setGrabId(row.id)}
                  onMouseUp={() => setGrabId(undefined)}
                >
                  ⋮⋮
                </span>
                <input
                  ref={(element) => {
                    if (element) inputRefs.current.set(row.id, element);
                    else inputRefs.current.delete(row.id);
                  }}
                  className="line-list-cell"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-labelledby={labelId}
                  tabIndex={-1}
                  readOnly={!isEditing}
                  placeholder={placeholder}
                  value={row.text}
                  onChange={(event) => {
                    const text = event.target.value;
                    applyRows(rows.map((candidate) => (candidate.id === row.id ? { ...candidate, text } : candidate)));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitEdit();
                      listRef.current?.focus({ preventScroll: true });
                    } else if (event.key === "Escape") {
                      // ダイアログ自体が閉じないよう、編集の取り消しだけで止める。
                      event.preventDefault();
                      event.stopPropagation();
                      cancelEdit();
                    }
                  }}
                  onBlur={() => {
                    if (editingRef.current === row.id) commitEdit();
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
