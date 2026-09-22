// 責務: 契約プランで接続できる国の参考一覧を、選択・お気に入り操作のできない一覧として表示するだけの部品。
// 接続先を選べないプランで、自動接続の行き先の候補を示す（webserver/requirements.md「プランで接続できる接続先の参考表示」）。
// 【Phase 16】接続先リスト（LocationList/LocationRow）と見た目を揃えた行形式で表示し、現在接続中の国が
// 分かるときは「接続中」バッジを付ける（webserver/requirements.md「参考一覧での現在の接続先の表示」）。
// 選択・お気に入りはできないため、ラジオ入力や★ボタンではなく非活性の表示のみを置く（あくまでUI表示の共通化に留める）。

import type { AvailableLocation } from "../../hooks/useAvailableLocations";
import type { CurrentAvailableLocation } from "../../locations/current-available-location";

interface Props {
  locations: AvailableLocation[];
  // 現在接続中の国（特定できないときはundefined。webserver/design.md「現在の接続先の特定」）。
  current?: CurrentAvailableLocation;
  // ping値の列を表示するか（CLIがping計測に対応しているか。capabilities/capability-state.tsのsupportsLocationPing）。
  // この一覧自体は生存確認なしの静的なサーバ一覧に基づくため、対応していても実際の値は「-」のままになる。
  showPing: boolean;
}

export function AvailableLocations({ locations, current, showPing }: Props) {
  if (locations.length === 0) return null;
  return (
    <div className="available-locations" role="group" aria-label="接続できる国（参考）">
      <p className="hint">自動接続で、次のいずれかの国のサーバに接続されます（選択はできません）。</p>
      <div className="location-scroll">
        <ul className="location-items">
          {locations.map((location) => {
            const isCurrent = current?.code === location.code;
            const title = isCurrent ? current.city : location.name;
            const subtitle = isCurrent
              ? location.name
              : location.cities.length > 0
                ? location.cities.join("、")
                : undefined;
            return (
              <li key={location.code} className="location-item">
                <div className="location-row location-row-static">
                  <span className="location-iso">{location.code.toUpperCase()}</span>
                  <span className="location-name">
                    <span className="location-title">
                      <strong>{title}</strong>
                      {isCurrent ? <span className="badge badge-ok">接続中</span> : null}
                    </span>
                    {subtitle ? <span className="hint">{subtitle}</span> : null}
                  </span>
                  {showPing ? <span className="location-ping">-</span> : null}
                </div>
                <button
                  type="button"
                  className="star"
                  disabled
                  aria-hidden="true"
                  tabIndex={-1}
                  title="参考表示のためお気に入り登録はできません"
                >
                  ☆
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
