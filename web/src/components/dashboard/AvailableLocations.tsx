// 責務: 契約プランで接続できる国（と都市）の参考一覧を、操作できない要素として表示するだけの部品。
// 接続先を選べないプランで、自動接続の行き先の候補を示す（webserver/requirements.md「プランで接続できる接続先の参考表示」）。

import type { AvailableLocation } from "../../hooks/useAvailableLocations";

interface Props {
  locations: AvailableLocation[];
}

export function AvailableLocations({ locations }: Props) {
  if (locations.length === 0) return null;
  return (
    <div className="available-locations" role="group" aria-label="接続できる国（参考）">
      <p className="hint">自動接続で、次のいずれかの国のサーバに接続されます（選択はできません）。</p>
      <ul>
        {locations.map((location) => (
          <li key={location.code}>
            <strong>{location.name}</strong>
            {location.cities.length > 0 ? <span>（{location.cities.join("、")}）</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
