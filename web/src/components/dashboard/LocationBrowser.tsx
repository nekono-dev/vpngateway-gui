import { useMemo, useReducer, useState } from "react";
import type {
  GetV1ConnectionFavorites200Item,
  GetV1ConnectionLocations200Item,
  GetV1ConnectionLocationsCountryCities200Item,
  GetV1ConnectionLocationsCityIdServers200Item,
} from "../../generated/api/endpoints.schemas";
import { LocationBackBar } from "../../locations/LocationBackBar";
import { createLocationBrowserState, locationBrowserReducer } from "../../locations/location-browser-state";
import { CityList } from "./CityList";
import { ServerList } from "./ServerList";
import type { ErrorContent } from "../../notifications/describe-api-error";

interface Props {
  countries: GetV1ConnectionLocations200Item[];
  favorites: GetV1ConnectionFavorites200Item[];
  cities: GetV1ConnectionLocationsCountryCities200Item[];
  servers: GetV1ConnectionLocationsCityIdServers200Item[];
  isLoading: boolean;
  isRefreshing: boolean;
  cityError: ErrorContent | undefined;
  cityTab: "fastest" | "select";
  hasServerSelection: boolean;
  disabled: boolean;
  onConnect: (locationId: string) => void;
  onToggleFavorite: (locationId: string, favorite: boolean) => void;
  onRefresh: () => void;
  onCityTabChange: (tab: "fastest" | "select") => void;
}

/** 国・都市・サーバを切り替える。取得と接続要求は親から受け取る。 */
export function LocationBrowser({ countries, favorites, cities, servers, isLoading, isRefreshing, cityError, cityTab, hasServerSelection, disabled, onConnect, onToggleFavorite, onRefresh, onCityTabChange }: Props) {
  const [state, dispatch] = useReducer(locationBrowserReducer, undefined, () => createLocationBrowserState("server-selection", cityTab));
  const [query, setQuery] = useState("");
  const countryId = state.screen.type === "cities" || state.screen.type === "servers" ? state.screen.countryId : undefined;
  const cityId = state.screen.type === "servers" ? state.screen.cityId : undefined;
  const city = cityId === undefined ? undefined : cities.find((item) => item.id === cityId);
  const visibleCountries = useMemo(() => countries.filter((item) =>
    (state.countryTab === "all" || item.favorite) && `${item.countryName} ${item.country}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [countries, state.countryTab, query]);
  const visibleFavorites = favorites.filter((item) => item.kind === "city" || item.kind === "server");

  if (state.screen.type === "countries") {
    const showingFavorites = state.countryTab === "favorites";
    return <div className="location-list">
      <LocationBackBar screen={state.screen} onBack={() => dispatch({ type: "back" })}>
        <div role="tablist" aria-label="国の表示" className="location-tabs">
          <button type="button" role="tab" aria-selected={!showingFavorites} className={!showingFavorites ? "tab-active" : undefined} onClick={() => dispatch({ type: "set-country-tab", tab: "all" })}>すべて</button>
          <button type="button" role="tab" aria-selected={showingFavorites} className={showingFavorites ? "tab-active" : undefined} onClick={() => dispatch({ type: "set-country-tab", tab: "favorites" })}>お気に入り</button>
        </div>
      </LocationBackBar>
      <input type="search" aria-label="国を絞り込み" placeholder="国名で絞り込み" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="location-scroll">
        {showingFavorites ? <ul role="radiogroup" aria-label="お気に入り" className="location-items">
          {visibleFavorites.map((favorite) => <li className="location-item" key={`${favorite.kind}:${favorite.id}`}>
            <label className="location-row">
              <input type="radio" name="favorite" className="visually-hidden" disabled={disabled} onChange={() => onConnect(favorite.id)} />
              <span className="location-iso">{favorite.country.toUpperCase()}</span>
              <span className="location-name"><span className="location-title"><strong>{favorite.kind === "city" ? favorite.city : favorite.serverName}</strong></span></span>
              {favorite.kind === "server" ? <span>{favorite.serverName}</span> : null}
            </label>
          </li>)}
        </ul> : <ul role="radiogroup" aria-label="国" className="location-items">
          {visibleCountries.map((item) => <li key={item.id} className="location-item">
            <label className="location-row">
              <input type="radio" name="country" className="visually-hidden" disabled={disabled} onChange={() => dispatch({ type: "select-country", countryId: item.id })} />
              <span className="location-iso">{item.country.toUpperCase()}</span>
              <span className="location-name"><span className="location-title"><strong>{item.countryName}</strong>{item.lastConnected ? <span className="badge badge-muted">前回</span> : null}</span></span>
              {item.distanceKm === undefined ? null : <span className="location-distance">約 {item.distanceKm.toLocaleString("ja-JP")} km</span>}
            </label>
          </li>)}
        </ul>}
      </div>
    </div>;
  }

  if (state.screen.type === "cities") return <div className="location-list">
    <CityList
      cities={cities.filter((item) => `${item.city} ${item.countryName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))}
      isLoading={isLoading} isRefreshing={isRefreshing} error={cityError} tab={cityTab}
      hasServerSelection={hasServerSelection} countryId={countryId} onBack={() => dispatch({ type: "back" })}
      disabled={disabled} onTabChange={onCityTabChange} onConnect={onConnect}
      onSelectCity={(selectedCityId) => dispatch({ type: "select-city", cityId: selectedCityId })}
      onToggleFavorite={onToggleFavorite} onRefresh={onRefresh}
      query={query} onQueryChange={setQuery}
    />
  </div>;

  return <div className="location-list">
    <LocationBackBar screen={state.screen} parentName={city?.city} onBack={() => dispatch({ type: "back" })} />
    <ServerList servers={servers} disabled={disabled} onSelect={onConnect} onToggleFavorite={onToggleFavorite} />
  </div>;
}
