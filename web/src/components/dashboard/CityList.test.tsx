import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CityList } from "./CityList";
import type { GetV1ConnectionLocationsCountryCities200Item } from "../../generated/api/endpoints.schemas";

const CITIES: GetV1ConnectionLocationsCountryCities200Item[] = [
  { id: "jp-tokyo", country: "jp", countryName: "Japan", city: "Tokyo", favorite: false, lastConnected: false },
  { id: "jp-osaka", country: "jp", countryName: "Japan", city: "Osaka", favorite: true, lastConnected: false },
];
function setup(overrides: Partial<React.ComponentProps<typeof CityList>> = {}) {
  cleanup();
  const props = { cities: CITIES, isLoading: false, isRefreshing: false, error: undefined, tab: "fastest" as const, hasServerSelection: true, disabled: false, onTabChange: vi.fn(), onConnect: vi.fn(), onSelectCity: vi.fn(), onToggleFavorite: vi.fn(), onRefresh: vi.fn(), ...overrides };
  const view = render(<CityList {...props} />);
  return { ...props, rerender: (next: Partial<React.ComponentProps<typeof CityList>>) => view.rerender(<CityList {...props} {...next} />) };
}

describe("CityList", () => {
  it("ProtonVPN相当では2タブ、AdGuard VPN相当では最速サーバだけを表示する", () => {
    setup();
    expect(screen.getByRole("tab", { name: "最速サーバ" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "サーバを選択" })).toBeInTheDocument();
    setup({ hasServerSelection: false });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["最速サーバ"]);
  });

  it("最速サーバの都市選択は接続し、サーバ選択の都市選択は一覧へ進む", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("radio", { name: /Tokyo/ }));
    expect(props.onConnect).toHaveBeenCalledWith("jp-tokyo");
    fireEvent.click(screen.getByRole("tab", { name: "サーバを選択" }));
    props.rerender({ tab: "select" });
    await userEvent.click(screen.getByRole("radio", { name: /Osaka/ }));
    expect(props.onSelectCity).toHaveBeenCalledWith("jp-osaka");
  });

  it("☆は最速タブとサーバ段なしで表示し、☆操作は都市選択を呼ばない", async () => {
    const props = setup();
    const star = screen.getByRole("button", { name: "Tokyoをお気に入りに追加" });
    await userEvent.click(star);
    expect(props.onToggleFavorite).toHaveBeenCalledWith("jp-tokyo", true);
    expect(props.onConnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "サーバを選択" }));
    props.rerender({ tab: "select" });
    expect(screen.queryByRole("button", { name: /お気に入り/ })).not.toBeInTheDocument();
    setup({ hasServerSelection: false });
    expect(screen.getByRole("button", { name: /Osakaのお気に入りを解除/ })).toBeInTheDocument();
  });

  it("取得失敗時にエラーと再取得ボタンを表示する", async () => {
    const props = setup({ error: { summary: "都市一覧の取得に失敗しました" } });
    expect(screen.getByRole("alert")).toHaveTextContent("都市一覧の取得に失敗しました");
    await userEvent.click(screen.getByRole("button", { name: "再取得" }));
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });
});
