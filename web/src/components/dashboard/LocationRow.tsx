// 責務: 接続先リストの1行（国コード・都市・国名・ping・バッジ・お気に入りの★）の表示と選択のみを行う。
// 選択はラジオ入力（キーボード操作・支援技術のため）、★は別のボタンとして行の外側に置く
// （ラベルの中に操作要素を入れ子にしないため）。

import { locationLabel, type LocationItem } from "../../locations/location-filter";

interface Props {
  location: LocationItem;
  selected: boolean;
  // 現在接続中の接続先か。
  current: boolean;
  disabled: boolean;
  // ping値の列を表示するか。どの接続先にもping値が無い（プロバイダが提供しない）一覧では非表示にする。
  showPing: boolean;
  // ★（お気に入り）を操作できない理由。指定されていれば★を無効化する（capabilityの`locationFavorites`が不可のとき）。
  favoriteDisabledReason?: string;
  onSelect: () => void;
  onToggleFavorite: () => void;
}

/**
 * 目的: pingの値を表示用文字列にする。
 * 入力: pingMs(ミリ秒。取得できなかった接続先ではundefined)。
 * 出力: 取得できれば「N ms」、できなければ「-」。
 */
function formatPing(pingMs: number | undefined): string {
  return pingMs === undefined ? "-" : `${pingMs} ms`;
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
          {location.city !== undefined ? <span className="hint">{location.countryName}</span> : null}
        </span>
        {showPing ? <span className="location-ping">{formatPing(location.pingMs)}</span> : null}
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
