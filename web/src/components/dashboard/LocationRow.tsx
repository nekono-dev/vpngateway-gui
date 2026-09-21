// 責務: 接続先リストの1行（国コード・都市・国名・ping・バッジ・お気に入りの★）の表示と選択のみを行う。
// 選択はラジオ入力（キーボード操作・支援技術のため）、★は別のボタンとして行の外側に置く
// （ラベルの中に操作要素を入れ子にしないため）。

import type { LocationItem } from "../../locations/location-filter";

interface Props {
  location: LocationItem;
  selected: boolean;
  // 現在接続中の接続先か。
  current: boolean;
  disabled: boolean;
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

export function LocationRow({ location, selected, current, disabled, onSelect, onToggleFavorite }: Props) {
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
            <strong>{location.city}</strong>
            {current ? <span className="badge badge-ok">接続中</span> : null}
            {location.lastConnected ? <span className="badge badge-muted">前回</span> : null}
          </span>
          <span className="hint">{location.countryName}</span>
        </span>
        <span className="location-ping">{formatPing(location.pingMs)}</span>
      </label>
      <button
        type="button"
        className="star"
        aria-pressed={location.favorite}
        aria-label={location.favorite ? `${location.city}のお気に入りを解除` : `${location.city}をお気に入りに追加`}
        onClick={onToggleFavorite}
      >
        {location.favorite ? "★" : "☆"}
      </button>
    </li>
  );
}
