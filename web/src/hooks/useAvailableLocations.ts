// 責務: 契約プランで接続できる接続先（国・都市）の参考一覧（`GET /v1/connection/available-locations`）の取得。
// 接続先を選べないプランで、自動接続の行き先の候補を画面に出すために使う（選択はできない）。
// 参考情報のため、取得の失敗・空は「表示しない」として扱い、通知しない。

import { useEffect, useState } from "react";
import { getV1ConnectionAvailableLocations } from "../generated/api/default/default";

export interface AvailableLocation {
  code: string;
  name: string;
  cities: string[];
}

/**
 * 目的: 接続できる接続先の参考一覧を取得する。
 * 入力: enabled(取得するか。接続先リストが制限されているときだけtrue), providerId(選択中のベンダーID),
 *       planId(現在のプランID。再ログインでプランが変わったら取得し直すための依存値)。
 * 出力: 一覧（取得前・失敗・対象外は空配列）。
 * 副作用: enabled・providerId・planIdのいずれかが変わるたびに1回取得する（ポーリングしない）。
 *        古い取得の結果（前のベンダー・プランのもの）は捨てる。
 */
export function useAvailableLocations(enabled: boolean, providerId?: string, planId?: string): AvailableLocation[] {
  const [locations, setLocations] = useState<AvailableLocation[]>([]);

  useEffect(() => {
    setLocations([]);
    if (!enabled) return;
    let stale = false;
    getV1ConnectionAvailableLocations()
      .then((response) => {
        if (!stale && response.status === 200) setLocations(response.data.locations);
      })
      .catch(() => undefined); // 参考情報のため、失敗は表示しないだけにする。
    return () => {
      stale = true;
    };
  }, [enabled, providerId, planId]);

  return locations;
}
