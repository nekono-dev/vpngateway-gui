// 責務: 接続先リスト（タブ・絞り込み・空表示・ping表示・選択・バッジ）のコンポーネントテスト。
// 親（App）の状態に依存しないよう、LocationListを直接描画して検証する。

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocationList } from "./LocationList";
import type { LocationItem } from "../../locations/location-filter";

const item = (id: string, country: string, countryName: string, city: string, pingMs: number | undefined, extra = {}): LocationItem => ({
  id, country, countryName, city, pingMs, favorite: false, lastConnected: false, ...extra,
});
const LOCATIONS = [
  item("jp-tokyo", "jp", "Japan", "Tokyo", 4, { favorite: true }),
  item("kr-seoul", "kr", "South Korea", "Seoul", 28),
  item("us-las-vegas", "us", "United States", "Las Vegas", 111, { favorite: true, lastConnected: true }),
  item("xx-unknown", "xx", "Nowhere", "Unknown", undefined),
];

function renderList(overrides: Partial<React.ComponentProps<typeof LocationList>> = {}) {
  const props = {
    locations: LOCATIONS,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    selectedId: undefined,
    currentId: undefined,
    disabled: false,
    onSelect: vi.fn(),
    onRefresh: vi.fn(),
    onToggleFavorite: vi.fn(),
    ...overrides,
  };
  render(<LocationList {...props} />);
  return props;
}

const rowTexts = () => screen.getAllByRole("radio").map((radio) => radio.closest("li")!.textContent ?? "");

describe("LocationList", () => {
  it("APIが返した順（ping昇順）のまま、国コード・都市・国名・pingを表示し、ping不明は「-」", () => {
    renderList();
    const rows = rowTexts();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/JP.*Tokyo.*Japan.*4 ms/);
    expect(rows[2]).toContain("前回");
    expect(rows[3]).toMatch(/Unknown.*-/);
  });

  it("タブに件数を表示し、「お気に入り」タブではお気に入りだけをping順で表示する", async () => {
    renderList();
    expect(screen.getByRole("tab", { name: "すべて (4)" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "お気に入り (2)" }));
    expect(rowTexts().map((text) => text.match(/Tokyo|Las Vegas/)?.[0])).toEqual(["Tokyo", "Las Vegas"]);
    expect(screen.getByRole("tab", { name: "お気に入り (2)" })).toHaveAttribute("aria-selected", "true");
  });

  it("★の状態を表示し、押すと反転した値でonToggleFavoriteを呼ぶ", async () => {
    const { onToggleFavorite } = renderList();
    expect(screen.getByRole("button", { name: "Tokyoのお気に入りを解除" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Seoulをお気に入りに追加" }));
    expect(onToggleFavorite).toHaveBeenCalledWith("kr-seoul", true);
    await userEvent.click(screen.getByRole("button", { name: "Tokyoのお気に入りを解除" }));
    expect(onToggleFavorite).toHaveBeenCalledWith("jp-tokyo", false);
  });

  it("国名・都市名の入力で絞り込み、該当なしなら案内を出す。順序は保たれる", async () => {
    renderList();
    await userEvent.type(screen.getByRole("searchbox", { name: "接続先を絞り込み" }), "o");
    // "o": Tokyo / Seoul / South Korea / Japan(no) ... Japanに"o"は無いがTokyoにある
    expect(rowTexts().map((text) => text.match(/Tokyo|Seoul|Las Vegas|Unknown/)?.[0])).toEqual(["Tokyo", "Seoul", "Unknown"]);
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("該当する接続先がありません。")).toBeInTheDocument();
  });

  it("お気に入りが0件のときは、追加方法を案内する", async () => {
    renderList({ locations: LOCATIONS.map((location) => ({ ...location, favorite: false })) });
    await userEvent.click(screen.getByRole("tab", { name: "お気に入り (0)" }));
    expect(screen.getByText(/お気に入りはまだありません/)).toBeInTheDocument();
  });

  it("選択・現在の接続先を反映し、行の選択でonSelectを呼ぶ", async () => {
    const { onSelect } = renderList({ selectedId: "kr-seoul", currentId: "jp-tokyo" });
    expect(screen.getByRole("radio", { name: /Seoul/ })).toBeChecked();
    expect(within(screen.getByRole("radio", { name: /Tokyo/ }).closest("li")!).getByText("接続中")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Las Vegas/ }));
    expect(onSelect).toHaveBeenCalledWith("us-las-vegas");
  });

  it("操作の送信中（disabled）は選択できない", () => {
    renderList({ disabled: true });
    expect(screen.getByRole("radio", { name: /Seoul/ })).toBeDisabled();
  });

  it("再計測ボタンでonRefreshを呼び、再計測中は無効化して表示を変える", async () => {
    const { onRefresh } = renderList();
    await userEvent.click(screen.getByRole("button", { name: "再計測" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("再計測中は一覧を残したまま、ボタンを無効化する", () => {
    renderList({ isRefreshing: true });
    expect(screen.getByRole("button", { name: "計測中..." })).toBeDisabled();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });

  it("初回取得中はローディングを表示する", () => {
    renderList({ isLoading: true, locations: [] });
    expect(screen.getByText("接続先を取得中...")).toBeInTheDocument();
  });
});
