// 責務: 行リストエディタ（LineListEditor）のテスト。選択（単独・Ctrl・Shift）、2回目のクリックでの編集、
// 追加位置（選択行のうち最下行の直後、選択なしは先頭）、削除、空欄の自動削除、上限、無効時を検証する。

import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LineListEditor } from "./LineListEditor";

function Harness({ initial, maxItems, disabled, onValue }: { initial: string[]; maxItems?: number; disabled?: boolean; onValue?: (v: string[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <LineListEditor
      label="迂回ドメイン"
      value={value}
      maxItems={maxItems}
      disabled={disabled}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

function options(): HTMLElement[] {
  return screen.getAllByRole("option");
}
function texts(): string[] {
  return screen.queryAllByRole("option").map((option) => (within(option).getByRole("textbox") as HTMLInputElement).value);
}
function selectedTexts(): string[] {
  return screen
    .queryAllByRole("option", { selected: true })
    .map((option) => (within(option).getByRole("textbox") as HTMLInputElement).value);
}

describe("LineListEditor", () => {
  it("1回目のクリックで選択、選択中の行の2回目のクリックで編集に入る", async () => {
    render(<Harness initial={["a.example", "b.example"]} />);
    await userEvent.click(options()[0]);
    expect(selectedTexts()).toEqual(["a.example"]);
    expect(within(options()[0]).getByRole("textbox")).toHaveAttribute("readonly");
    await userEvent.click(options()[0]);
    expect(within(options()[0]).getByRole("textbox")).not.toHaveAttribute("readonly");
    expect(within(options()[0]).getByRole("textbox")).toHaveFocus();
  });

  it("編集して Enter で確定し、Esc で取り消せる", async () => {
    const onValue = vi.fn();
    render(<Harness initial={["a.example"]} onValue={onValue} />);
    await userEvent.click(options()[0]);
    await userEvent.click(options()[0]);
    await userEvent.keyboard("{Backspace}x{Enter}");
    expect(texts()).toEqual(["a.examplx"]);
    await userEvent.click(options()[0]);
    await userEvent.click(options()[0]);
    await userEvent.keyboard("zzz{Escape}");
    expect(texts()).toEqual(["a.examplx"]);
    expect(onValue).toHaveBeenLastCalledWith(["a.examplx"]);
  });

  it("Ctrl+クリックで選択を追加・解除し、Shift+クリックで範囲選択する", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b", "c", "d"]} />);
    await user.click(options()[0]);
    await user.keyboard("{Control>}");
    await user.click(options()[2]);
    await user.keyboard("{/Control}");
    expect(selectedTexts()).toEqual(["a", "c"]);
    await user.keyboard("{Control>}");
    await user.click(options()[0]);
    await user.keyboard("{/Control}");
    expect(selectedTexts()).toEqual(["c"]);
    await user.click(options()[1]);
    await user.keyboard("{Shift>}");
    await user.click(options()[3]);
    await user.keyboard("{/Shift}");
    expect(selectedTexts()).toEqual(["b", "c", "d"]);
  });

  it("追加は選択行のうち最も下の行の直後に入り、選択がなければ先頭に入る", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b", "c"]} />);
    await user.click(screen.getByRole("button", { name: /追加/ }));
    await user.keyboard("top{Enter}");
    expect(texts()).toEqual(["top", "a", "b", "c"]);

    await user.click(options()[1]);
    await user.keyboard("{Control>}");
    await user.click(options()[2]);
    await user.keyboard("{/Control}");
    await user.click(screen.getByRole("button", { name: /追加/ }));
    await user.keyboard("new{Enter}");
    expect(texts()).toEqual(["top", "a", "b", "new", "c"]);
    expect(selectedTexts()).toEqual(["new"]);
  });

  it("空のまま編集を終えた行は自動で削除される", async () => {
    const onValue = vi.fn();
    render(<Harness initial={["a"]} onValue={onValue} />);
    await userEvent.click(screen.getByRole("button", { name: /追加/ }));
    await userEvent.keyboard("{Enter}");
    expect(texts()).toEqual(["a"]);
    expect(onValue).toHaveBeenLastCalledWith(["a"]);
  });

  it("削除は選択中の行をまとめて消し、選択がないと押せない。削除後は次の行を選ぶ", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b", "c", "d"]} />);
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
    await user.click(options()[1]);
    await user.keyboard("{Control>}");
    await user.click(options()[2]);
    await user.keyboard("{/Control}");
    await user.click(screen.getByRole("button", { name: "削除（2件）" }));
    expect(texts()).toEqual(["a", "d"]);
    expect(selectedTexts()).toEqual(["d"]);
  });

  it("キーボード: ↓で選択を移動し、Deleteで削除、Ctrl+Aで全選択する", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b", "c"]} />);
    screen.getByRole("listbox").focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(selectedTexts()).toEqual(["b"]);
    await user.keyboard("{Delete}");
    expect(texts()).toEqual(["a", "c"]);
    await user.keyboard("{Control>}a{/Control}");
    expect(selectedTexts()).toEqual(["a", "c"]);
  });

  it("上限に達したら追加できない", async () => {
    render(<Harness initial={["a", "b"]} maxItems={2} />);
    expect(screen.getByText("2 / 2件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /追加/ })).toBeDisabled();
  });

  it("掴み部のドラッグで行を並べ替える", () => {
    render(<Harness initial={["a", "b", "c"]} />);
    const rows = options();
    const grip = rows[0].querySelector(".line-list-grip") as HTMLElement;
    fireEvent.mouseDown(grip);
    fireEvent.dragStart(rows[0], { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    rows[2].getBoundingClientRect = () => ({ top: -10, height: 10 }) as DOMRect;
    // jsdomのドラッグイベントはclientYを持たないため、直接設定する。
    fireEvent(rows[2], Object.assign(createEvent.dragOver(rows[2]), { clientY: 9 }));
    fireEvent(rows[2], Object.assign(createEvent.drop(rows[2]), { clientY: 9 }));
    expect(texts()).toEqual(["b", "c", "a"]);
  });

  it("無効のときは全ての操作を受け付けない", async () => {
    render(<Harness initial={["a"]} disabled />);
    expect(screen.getByRole("button", { name: /追加/ })).toBeDisabled();
    await userEvent.click(options()[0]);
    expect(selectedTexts()).toEqual([]);
  });
});
