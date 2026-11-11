import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocationBrowser } from "./LocationBrowser";

const countries = [
  { id: "jp", country: "jp", countryName: "Japan", hasServerStage: true, favorite: false, lastConnected: false },
];
const cities = [
  { id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo", favorite: true, lastConnected: false },
];
const servers = [
  { name: "jp-tokyo-01", tier: "free" as const, load: 20, score: 1, favorite: true, connected: false },
];
const favorites = [
  { id: "jp-tokyo", kind: "city" as const, country: "jp", countryName: "Japan", city: "Tokyo" },
  { id: "jp-tokyo-01", kind: "server" as const, country: "jp", countryName: "Japan", city: "Tokyo", serverName: "jp-tokyo-01" },
  { id: "legacy-country", kind: "country", country: "jp", countryName: "Japan", city: "" },
] as unknown as import("../../generated/api/endpoints.schemas").GetV1ConnectionFavorites200Item[];

function renderBrowser(overrides: Partial<React.ComponentProps<typeof LocationBrowser>> = {}) {
  const props = {
    countries, favorites, cities, servers, isLoading: false, isRefreshing: false, cityError: undefined,
    cityTab: "select" as const, hasServerSelection: true, disabled: false,
    onSelect: vi.fn(), onToggleCityFavorite: vi.fn(), onToggleServerFavorite: vi.fn(), onRefresh: vi.fn(), onCityTabChange: vi.fn(),
    onCountryChange: vi.fn(), onCityChange: vi.fn(),
  };
  const merged = { ...props, ...overrides };
  render(<LocationBrowser {...merged} />);
  return merged;
}

describe("LocationBrowser", () => {
  it.each([[2102.7, "約 2.1k km"], [0, "約 0.0k km"]] as const)("国の距離 %s km を共通の千km形式で表示する", (distanceKm, expected) => {
    renderBrowser({ countries: [{ ...countries[0], distanceKm }] });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("距離のない国には距離を表示しない", () => {
    renderBrowser();
    expect(screen.queryByText(/^約 /)).not.toBeInTheDocument();
  });

  it("国から都市、都市からサーバへ遷移し、国行では接続先を選ばない", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderBrowser();
    expect(screen.getByRole("tab", { name: "すべて" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "お気に入り" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Japan/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "‹ 国一覧" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "サーバを選択" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Tokyo/ }));
    expect(screen.getByRole("list", { name: "サーバ" })).toBeInTheDocument();
    expect(screen.getByText("jp-tokyo-01")).toBeInTheDocument();
  });

  it("お気に入りに都市とサーバを表示し、旧形式の国項目は隠し、選んだ接続先を通知する", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderBrowser();
    await user.click(screen.getByRole("tab", { name: "お気に入り" }));
    expect(screen.getByRole("radio", { name: /Tokyo/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Tokyo/ }).closest("label")).not.toHaveTextContent("Japan");
    expect(screen.getByRole("radio", { name: /jp-tokyo-01/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /legacy-country/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /jp-tokyo-01/ }));
    expect(onSelect).toHaveBeenCalledWith("jp-tokyo-01");
  });

  it("都市取得エラーを表示し、再取得できる", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderBrowser({ cityError: { summary: "都市一覧を取得できませんでした" }, onRefresh });
    await user.click(screen.getByRole("radio", { name: /Japan/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("都市一覧を取得できませんでした");
    await user.click(screen.getByRole("button", { name: "再取得" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
