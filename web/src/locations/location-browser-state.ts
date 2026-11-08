/** Pure navigation and tab rules for the country → city → server browser. */

export type LocationProvider = "server-selection" | "fastest-only";
export type CountryTab = "all" | "favorites";
export type CityTab = "fastest" | "select";

export type LocationBrowserScreen =
  | { type: "countries" }
  | { type: "cities"; countryId: string }
  | { type: "servers"; countryId: string; cityId: string };

export interface LocationBrowserState {
  provider: LocationProvider;
  screen: LocationBrowserScreen;
  countryTab: CountryTab;
  cityTab: CityTab;
}

/** The horizontal movement required to recognize a rightward swipe. */
export const SWIPE_BACK_THRESHOLD_PX = 50;

/** Returns the back control label for a nested screen, or null at the root. */
export function getLocationBackLabel(screen: LocationBrowserScreen, parentName?: string): string | null {
  if (screen.type === "countries") return null;
  if (screen.type === "cities") return "‹ 国一覧";
  return parentName ? `‹ ${parentName}` : null;
}

/** Recognizes a rightward swipe only while a parent screen exists. */
export function shouldSwipeBack(
  screen: LocationBrowserScreen,
  horizontalDelta: number,
  threshold = SWIPE_BACK_THRESHOLD_PX,
): boolean {
  return screen.type !== "countries" && horizontalDelta >= threshold;
}

export type LocationBrowserAction =
  | { type: "select-country"; countryId: string }
  | { type: "select-city"; cityId: string }
  | { type: "back" }
  | { type: "set-country-tab"; tab: CountryTab }
  | { type: "set-city-tab"; tab: CityTab };

/** The default tab used when a provider has no saved city-tab preference. */
export function defaultCityTab(provider: LocationProvider, savedTab?: CityTab): CityTab {
  return provider === "fastest-only" ? "fastest" : savedTab ?? "fastest";
}

export function createLocationBrowserState(provider: LocationProvider, savedCityTab?: CityTab): LocationBrowserState {
  return {
    provider,
    screen: { type: "countries" },
    countryTab: "all",
    cityTab: defaultCityTab(provider, savedCityTab),
  };
}

export function locationBrowserReducer(state: LocationBrowserState, action: LocationBrowserAction): LocationBrowserState {
  switch (action.type) {
    case "select-country":
      if (state.screen.type !== "countries") return state;
      return { ...state, screen: { type: "cities", countryId: action.countryId } };
    case "select-city":
      if (state.screen.type !== "cities") return state;
      return {
        ...state,
        screen: { type: "servers", countryId: state.screen.countryId, cityId: action.cityId },
      };
    case "back":
      if (state.screen.type === "servers") {
        return { ...state, screen: { type: "cities", countryId: state.screen.countryId } };
      }
      if (state.screen.type === "cities") return { ...state, screen: { type: "countries" } };
      return state;
    case "set-country-tab":
      return { ...state, countryTab: action.tab };
    case "set-city-tab":
      if (state.provider === "fastest-only" && action.tab === "select") return state;
      return { ...state, cityTab: action.tab };
  }
}
