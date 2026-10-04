import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HorizontalScroll } from "./HorizontalScroll";

// jsdomはレイアウトを持たないため、寸法とscrollLeftを差し替えて、はみ出している状態を作る。
function mockOverflow(element: HTMLElement) {
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: 400 });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: 200 });
  let left = 0;
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      left = value;
    },
  });
}

describe("HorizontalScroll", () => {
  it("はみ出していないときは、自前のバーを表示しない", () => {
    const { container } = render(
      <HorizontalScroll role="tablist" aria-label="項目">
        <button>a</button>
      </HorizontalScroll>,
    );
    expect(container.querySelector(".hscroll-track")).toBeNull();
  });

  it("縦ホイールを横スクロールへ変換し、端では変換せずページへ譲る", () => {
    render(
      <HorizontalScroll role="tablist" aria-label="項目">
        <button>a</button>
      </HorizontalScroll>,
    );
    const viewport = screen.getByRole("tablist");
    mockOverflow(viewport);

    const down = new WheelEvent("wheel", { deltaY: 50, cancelable: true });
    viewport.dispatchEvent(down);
    expect(viewport.scrollLeft).toBe(50);
    expect(down.defaultPrevented).toBe(true);

    // 先頭で上方向へ回しても、動かせないので横スクロールへは変換しない。
    viewport.scrollLeft = 0;
    const up = new WheelEvent("wheel", { deltaY: -50, cancelable: true });
    viewport.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);

    // 横の動きが主なら標準の動作に任せる。
    const sideways = new WheelEvent("wheel", { deltaX: 50, deltaY: 5, cancelable: true });
    viewport.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(false);
  });

  it("スクロールすると、はみ出し分に応じたバーを表示する", () => {
    const { container } = render(
      <HorizontalScroll role="tablist" aria-label="項目">
        <button>a</button>
      </HorizontalScroll>,
    );
    const viewport = screen.getByRole("tablist");
    mockOverflow(viewport);
    fireEvent.scroll(viewport);
    const thumb = container.querySelector<HTMLElement>(".hscroll-thumb");
    expect(thumb).not.toBeNull();
    expect(thumb?.style.width).toBe("50%");
  });
});
