import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocationBackBar } from "./LocationBackBar";

describe("LocationBackBar", () => {
  it("親の名前を使った戻るボタンとタブを同じ左詰めの行に表示する", () => {
    const { container } = render(
      <LocationBackBar screen={{ type: "servers", countryId: "jp", cityId: "tokyo" }} parentName="東京" onBack={() => {}}>
        <button role="tab">最速サーバ</button>
        <button role="tab">サーバを選択</button>
      </LocationBackBar>,
    );

    expect(screen.getByRole("button", { name: "‹ 東京" })).toBeInTheDocument();
    const row = container.querySelector(".location-back-bar")!;
    expect(row).toHaveClass("flex", "items-center", "justify-start");
    expect(row).toHaveClass("gap-0");
    expect(Array.from(row.children).map((child) => child.textContent)).toEqual(["‹ 東京", "最速サーバ", "サーバを選択"]);
    expect(row).toHaveClass("p-0", "m-0");
    expect(row.className.split(/\s+/).filter((name) => /^[mp][trblxy]?-(?!0$)/.test(name))).toEqual([]);
    for (const child of Array.from(row.children)) {
      expect((child.getAttribute("class") ?? "").split(/\s+/).filter((name) => /^[mp][trblxy]?-(?!0$)/.test(name))).toEqual([]);
    }
  });

  it("都市一覧では国一覧へ戻るボタンを表示する", () => {
    render(<LocationBackBar screen={{ type: "cities", countryId: "jp" }} onBack={() => {}} />);
    expect(screen.getByRole("button", { name: "‹ 国一覧" })).toBeInTheDocument();
  });

  it("国一覧では戻るボタンを表示しない", () => {
    render(<LocationBackBar screen={{ type: "countries" }} onBack={() => {}} />);
    expect(screen.queryByRole("button", { name: /‹/ })).not.toBeInTheDocument();
  });

  it("右スワイプで戻り、左スワイプと短い移動では戻らない", () => {
    const onBack = vi.fn();
    const { container, rerender } = render(
      <LocationBackBar screen={{ type: "cities", countryId: "jp" }} onBack={onBack} />,
    );
    const row = container.querySelector(".location-back-bar")!;

    fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 70, clientY: 10 });
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(row, { pointerId: 1, clientX: 70, clientY: 10 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 40, clientY: 10 });
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender(<LocationBackBar screen={{ type: "countries" }} onBack={onBack} />);
    const countryRow = container.querySelector(".location-back-bar")!;
    fireEvent.pointerDown(countryRow, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(countryRow, { pointerId: 1, clientX: 70, clientY: 10 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("同じポインタなら行の外へ出て離しても戻る", () => {
    const onBack = vi.fn();
    const { container } = render(<LocationBackBar screen={{ type: "cities", countryId: "jp" }} onBack={onBack} />);
    const row = container.querySelector(".location-back-bar")!;
    const capture = vi.fn();
    Object.defineProperty(row, "setPointerCapture", { configurable: true, value: capture });

    fireEvent.pointerDown(row, { pointerId: 7, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document.body, { pointerId: 7, clientX: 75, clientY: 12 });
    // Capture retargets the outside release to the originating row in browsers.
    fireEvent.pointerUp(row, { pointerId: 7, clientX: 75, clientY: 12 });

    expect(capture).toHaveBeenCalledWith(7);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("pointercancel 後の pointerup では戻らない", () => {
    const onBack = vi.fn();
    const { container } = render(<LocationBackBar screen={{ type: "cities", countryId: "jp" }} onBack={onBack} />);
    const row = container.querySelector(".location-back-bar")!;
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerCancel(row, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 80, clientY: 0 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("縦方向の移動が横方向より大きいときは戻らない", () => {
    const onBack = vi.fn();
    const { container } = render(<LocationBackBar screen={{ type: "cities", countryId: "jp" }} onBack={onBack} />);
    const row = container.querySelector(".location-back-bar")!;
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 80, clientY: 81 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("別の pointerId のイベントでは戻らず、開始ポインタで判定する", () => {
    const onBack = vi.fn();
    const { container } = render(<LocationBackBar screen={{ type: "cities", countryId: "jp" }} onBack={onBack} />);
    const row = container.querySelector(".location-back-bar")!;
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(row, { pointerId: 2, clientX: 90, clientY: 0 });
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 60, clientY: 0 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
