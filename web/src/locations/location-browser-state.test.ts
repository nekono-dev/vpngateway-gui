import { describe, expect, it } from "vitest";
import {
  createLocationBrowserState,
  locationBrowserReducer,
  type LocationBrowserState,
} from "./location-browser-state";

describe("location browser state", () => {
  it("国から都市、都市からサーバへ進み、一つ上の階層へ戻る", () => {
    let state = createLocationBrowserState("server-selection");
    state = locationBrowserReducer(state, { type: "select-country", countryId: "jp" });
    expect(state.screen).toEqual({ type: "cities", countryId: "jp" });
    state = locationBrowserReducer(state, { type: "select-city", cityId: "jp-tokyo" });
    expect(state.screen).toEqual({ type: "servers", countryId: "jp", cityId: "jp-tokyo" });
    state = locationBrowserReducer(state, { type: "back" });
    expect(state.screen).toEqual({ type: "cities", countryId: "jp" });
    state = locationBrowserReducer(state, { type: "back" });
    expect(state.screen).toEqual({ type: "countries" });
  });

  it("上位階層へ戻って再び開いても各階層のタブを保持する", () => {
    let state: LocationBrowserState = createLocationBrowserState("server-selection");
    state = locationBrowserReducer(state, { type: "set-country-tab", tab: "favorites" });
    state = locationBrowserReducer(state, { type: "select-country", countryId: "jp" });
    state = locationBrowserReducer(state, { type: "set-city-tab", tab: "select" });
    state = locationBrowserReducer(state, { type: "select-city", cityId: "jp-tokyo" });
    state = locationBrowserReducer(state, { type: "back" });
    expect(state.cityTab).toBe("select");
    state = locationBrowserReducer(state, { type: "back" });
    expect(state.countryTab).toBe("favorites");
    state = locationBrowserReducer(state, { type: "select-country", countryId: "us" });
    expect(state.cityTab).toBe("select");
  });

  it("国一覧では戻らず、プロバイダごとに都市タブの既定値を使う", () => {
    const serverSelection = createLocationBrowserState("server-selection");
    const fastestOnly = createLocationBrowserState("fastest-only", "select");
    expect(locationBrowserReducer(serverSelection, { type: "back" })).toEqual(serverSelection);
    expect(serverSelection.cityTab).toBe("fastest");
    expect(fastestOnly.cityTab).toBe("fastest");
  });

  it("サーバ階層の無いプロバイダでは、タブ「サーバを選択」を設定できず、状態は変わらない", () => {
    const fastestOnly = createLocationBrowserState("fastest-only");
    const next = locationBrowserReducer(fastestOnly, { type: "set-city-tab", tab: "select" });
    expect(next).toEqual(fastestOnly);
    expect(next.cityTab).toBe("fastest");
  });
});
