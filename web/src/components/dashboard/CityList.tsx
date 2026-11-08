import type { GetV1ConnectionLocationsCountryCities200Item } from "../../generated/api/endpoints.schemas";
import type { ErrorContent } from "../../notifications/describe-api-error";
import { LocationBackBar } from "../../locations/LocationBackBar";
import type { CityTab } from "../../locations/location-browser-state";

interface Props {
  cities: GetV1ConnectionLocationsCountryCities200Item[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: ErrorContent | undefined;
  tab: CityTab;
  hasServerSelection: boolean;
  countryId?: string;
  onBack?: () => void;
  disabled: boolean;
  onTabChange: (tab: CityTab) => void;
  onConnect: (cityId: string) => void;
  onSelectCity: (cityId: string) => void;
  onToggleFavorite: (cityId: string, favorite: boolean) => void;
  onRefresh: () => void;
}

/** 都市一覧のタブ、都市行、取得エラーを表示する。データ取得と遷移は親に委ねる。 */
export function CityList({ cities, isLoading, isRefreshing, error, tab, hasServerSelection, countryId, onBack = () => {}, disabled, onTabChange, onConnect, onSelectCity, onToggleFavorite, onRefresh }: Props) {
  const tabs = (
    <LocationBackBar screen={{ type: "cities", countryId: countryId ?? cities[0]?.country ?? "" }} onBack={onBack}>
      <div role="tablist" aria-label="都市の接続方法" className="location-tabs">
        <button type="button" role="tab" aria-selected={tab === "fastest"} className={tab === "fastest" ? "tab-active" : undefined} onClick={() => onTabChange("fastest")}>最速サーバ</button>
        {hasServerSelection ? <button type="button" role="tab" aria-selected={tab === "select"} className={tab === "select" ? "tab-active" : undefined} onClick={() => onTabChange("select")}>サーバを選択</button> : null}
      </div>
    </LocationBackBar>
  );
  if (isLoading) return <div className="location-list">{tabs}</div>;

  if (error) {
    return (
      <div role="alert" className="location-error">
        {tabs}
        <strong>{error.summary}</strong>
        {error.detail ? <details><summary>詳細</summary><pre>{error.detail}</pre></details> : null}
        <button type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? "取得中..." : "再取得"}</button>
      </div>
    );
  }

  const showFavorite = !hasServerSelection || tab === "fastest";
  return (
    <div className="location-list">
      {tabs}
      {cities.length === 0 ? null : (
        <ul role="radiogroup" aria-label="都市" className="location-items">
          {cities.map((city) => (
            <li key={city.id} className="location-item">
              <label className="location-row">
                <input type="radio" name="city" className="visually-hidden" checked={false} disabled={disabled} onChange={() => tab === "fastest" ? onConnect(city.id) : onSelectCity(city.id)} />
                <span className="location-iso">{city.country.toUpperCase()}</span>
                <span className="location-name"><span className="location-title"><strong>{city.city}</strong>{city.lastConnected ? <span className="badge badge-muted">前回</span> : null}</span><span className="hint">{city.countryName}</span></span>
                {city.pingMs === undefined ? null : <span className="location-ping">{city.pingMs} ms</span>}
                {city.distanceKm === undefined ? null : <span className="location-distance">約 {city.distanceKm.toLocaleString("ja-JP")} km</span>}
              </label>
              {showFavorite ? <button type="button" className="star" aria-pressed={city.favorite} aria-label={city.favorite ? `${city.city}のお気に入りを解除` : `${city.city}をお気に入りに追加`} onClick={() => onToggleFavorite(city.id, !city.favorite)}>{city.favorite ? "★" : "☆"}</button> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
