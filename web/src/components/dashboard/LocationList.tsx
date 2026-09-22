// 責務: 接続先リストの組み立て（タブ「すべて」「お気に入り」・絞り込み入力・再計測ボタン・行の一覧・
// 取得失敗/空の表示）のみを行う。並び順はAPIが決めたping昇順をそのまま表示する。
// タブと検索語は表示上の状態としてここで保持し、選択・お気に入り・再計測はコールバックで親へ委ねる。

import { useState } from "react";
import { filterLocations, type LocationItem, type LocationTab } from "../../locations/location-filter";
import type { ErrorContent } from "../../notifications/describe-api-error";
import { LocationRow } from "./LocationRow";
import { AvailableLocations } from "./AvailableLocations";
import { RestrictionNote } from "./RestrictionNote";
import type { AvailableLocation } from "../../hooks/useAvailableLocations";
import type { CurrentAvailableLocation } from "../../locations/current-available-location";

interface Props {
  locations: LocationItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: ErrorContent | undefined;
  selectedId: string | undefined;
  currentId: string | undefined;
  // 接続操作の送信中。選択の変更を止める。
  disabled: boolean;
  onSelect: (locationId: string) => void;
  onRefresh: () => void;
  onToggleFavorite: (locationId: string, favorite: boolean) => void;
  // 接続先の一覧そのものが使えない理由（capabilityの`locationList`が不可のとき）。指定されると一覧・タブ・
  // 絞り込みを出さず、この理由文の枠だけを表示する（一覧を取得しない。webserver/requirements.md「操作の制限表示」）。
  unavailableReason?: string;
  // 一覧が使えないプランで接続できる国の参考一覧（理由文の下に表示する。空・未指定なら何も出さない）。
  availableLocations?: AvailableLocation[];
  // 参考一覧の中で現在接続中の国（Phase 16）。特定できないときはundefined。
  currentAvailableLocation?: CurrentAvailableLocation;
  // 参考一覧にping列を出すか（CLIがping計測に対応しているか）。
  availableLocationsShowPing?: boolean;
  // ★（お気に入り）・「再計測」を操作できない理由。指定されていれば該当ボタンを無効化して理由を表示する。
  favoritesDisabledReason?: string;
  refreshDisabledReason?: string;
}

const TAB_LABELS: Record<LocationTab, string> = { all: "すべて", favorites: "お気に入り" };

export function LocationList({
  locations,
  isLoading,
  isRefreshing,
  error,
  selectedId,
  currentId,
  disabled,
  onSelect,
  onRefresh,
  onToggleFavorite,
  unavailableReason,
  availableLocations,
  currentAvailableLocation,
  availableLocationsShowPing = true,
  favoritesDisabledReason,
  refreshDisabledReason,
}: Props) {
  const [tab, setTab] = useState<LocationTab>("all");
  const [query, setQuery] = useState("");

  const visible = filterLocations(locations, tab, query);
  const favoriteCount = locations.filter((location) => location.favorite).length;
  const counts: Record<LocationTab, number> = { all: locations.length, favorites: favoriteCount };
  // どの接続先にもping値が無いプロバイダ（国単位の一覧のみ等）では、ping列を出さない。
  const showPing = locations.some((location) => location.pingMs !== undefined);

  if (unavailableReason !== undefined) {
    return (
      // 通常時の一覧（.location-list）と同じflexの縦積みで囲み、内部の.location-scrollへ残り高さを渡す
      // （囲まないと参照一覧の行数ぶんだけ高さが伸び、ページ全体がビューポートを超えて表示されてしまう。
      // webserver/design.md「画面の縦幅をビューポートに収める」）。
      <div className="location-list">
        {/* ConnectButtonが同じ理由文のときaria-describedbyで参照する固定id（webserver/design.md「制限理由の重複表示の解消」）。 */}
        <RestrictionNote id="location-list-restriction" message={unavailableReason} />
        <AvailableLocations
          locations={availableLocations ?? []}
          current={currentAvailableLocation}
          showPing={availableLocationsShowPing}
        />
      </div>
    );
  }
  if (isLoading) {
    return <p className="hint">接続先を取得中...</p>;
  }

  if (error) {
    return (
      <div role="alert" className="location-error">
        <strong>{error.summary}</strong>
        {error.detail ? (
          <details>
            <summary>詳細</summary>
            <pre>{error.detail}</pre>
          </details>
        ) : null}
        <button type="button" disabled={isRefreshing} onClick={onRefresh}>
          {isRefreshing ? "取得中..." : "再取得"}
        </button>
      </div>
    );
  }

  return (
    <div className="location-list">
      <div className="location-toolbar">
        <div role="tablist" aria-label="接続先の表示" className="location-tabs">
          {(Object.keys(TAB_LABELS) as LocationTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "tab-active" : undefined}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]} ({counts[key]})
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={isRefreshing || refreshDisabledReason !== undefined}
          aria-describedby={refreshDisabledReason === undefined ? undefined : "refresh-restriction"}
          onClick={onRefresh}
        >
          {isRefreshing ? "計測中..." : "再計測"}
        </button>
      </div>
      <RestrictionNote id="refresh-restriction" message={refreshDisabledReason} />
      <RestrictionNote message={favoritesDisabledReason} />
      <input
        type="search"
        aria-label="接続先を絞り込み"
        placeholder="国名・都市名で絞り込み"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div role="tabpanel" className="location-scroll">
        {visible.length === 0 ? (
          <p className="hint">
            {locations.length === 0
              ? "接続先がありません。"
              : tab === "favorites" && favoriteCount === 0
                ? "お気に入りはまだありません。「すべて」タブの☆から追加できます。"
                : "該当する接続先がありません。"}
          </p>
        ) : (
          <ul role="radiogroup" aria-label="接続先" className="location-items">
            {visible.map((location) => (
              <LocationRow
                key={location.id}
                location={location}
                selected={location.id === selectedId}
                current={location.id === currentId}
                disabled={disabled}
                showPing={showPing}
                favoriteDisabledReason={favoritesDisabledReason}
                onSelect={() => onSelect(location.id)}
                onToggleFavorite={() => onToggleFavorite(location.id, !location.favorite)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
