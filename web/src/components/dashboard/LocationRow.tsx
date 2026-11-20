// 責務: 接続先リストの1行（国コード・国名・距離・バッジ・お気に入りの★）の表示と選択のみを行う。
// 選択はラジオ入力（キーボード操作・支援技術のため）、★は別のボタンとして行の外側に置く
// （ラベルの中に操作要素を入れ子にしないため）。

import { locationLabel, type LocationItem } from "../../locations/location-filter";
import { formatDistance } from "../../locations/format-distance";

interface Props {
  location: LocationItem;
  selected: boolean;
  // 現在接続中の接続先か。
  current: boolean;
  disabled: boolean;
  // 応答に計測値が含まれる場合だけ列を表示する。
  showPing: boolean;
  // ★（お気に入り）を操作できない理由。指定されていれば★を無効化する（capabilityの`locationFavorites`が不可のとき）。
  favoriteDisabledReason?: string;
  onSelect: () => void;
  onToggleFavorite: () => void;
}

export function LocationRow({
  location,
  selected,
  current,
  disabled,
  showPing,
  favoriteDisabledReason,
  onSelect,
  onToggleFavorite,
}: Props) {
  // 都市を持たない接続先（国単位の一覧）は国名を主表示にし、補足の国名は重複させない。
  const label = locationLabel(location);
  const city = "city" in location && typeof location.city === "string" ? location.city : undefined;
  const pingMs = "pingMs" in location && typeof location.pingMs === "number" ? location.pingMs : undefined;
  return (
    <li className={`location-item${selected ? " location-selected" : ""}`}>
      <label className="location-row">
        <input
          type="radio"
          name="location"
          className="visually-hidden"
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
        />
        <span className="location-iso">{location.country.toUpperCase()}</span>
        <span className="location-name">
          <span className="location-title">
            <strong>{label}</strong>
            {current ? <span className="badge badge-ok">接続中</span> : null}
            {location.lastConnected ? <span className="badge badge-muted">前回</span> : null}
          </span>
          {city !== undefined ? <span className="hint">{location.countryName}</span> : null}
        </span>
        {showPing ? <span className="location-ping">{pingMs === undefined ? "-" : `${pingMs} ms`}</span> : null}
        {location.distanceKm === undefined ? null : (
          <span className="location-distance">約 {formatDistance(location.distanceKm)}</span>
        )}
      </label>
      <button
        type="button"
        className="star"
        aria-pressed={location.favorite}
        aria-label={location.favorite ? `${label}のお気に入りを解除` : `${label}をお気に入りに追加`}
        disabled={favoriteDisabledReason !== undefined}
        title={favoriteDisabledReason}
        onClick={onToggleFavorite}
      >
        {location.favorite ? "★" : "☆"}
      </button>
    </li>
  );
}
