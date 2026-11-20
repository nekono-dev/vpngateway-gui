import { useCallback, useEffect, useState } from "react";
import { getV1ConnectionCityTab, putV1ConnectionCityTab } from "../generated/api/default/default";
import { describeApiError, describeThrownError, type ErrorContent } from "../notifications/describe-api-error";

export type CityTab = "fastest" | "select";

export interface CityTabState {
  tab: CityTab;
  isLoading: boolean;
  error: ErrorContent | undefined;
  save: (tab: CityTab) => Promise<void>;
}

/** 都市一覧で選択するタブを取得し、利用者の変更を保存する。 */
export function useCityTab(): CityTabState {
  const [tab, setTab] = useState<CityTab>("fastest");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ErrorContent>();

  useEffect(() => {
    let stale = false;
    getV1ConnectionCityTab().then((response) => {
      if (stale) return;
      if (response.status === 200) setTab(response.data.tab);
      else setError(describeApiError(response.status, response.data, "都市タブの取得に失敗しました"));
    }).catch((caughtError: unknown) => {
      if (!stale) setError(describeThrownError(caughtError, "都市タブの取得に失敗しました"));
    }).finally(() => {
      if (!stale) setIsLoading(false);
    });
    return () => { stale = true; };
  }, []);

  const save = useCallback(async (nextTab: CityTab) => {
    setTab(nextTab);
    await putV1ConnectionCityTab({ tab: nextTab });
  }, []);

  return { tab, isLoading, error, save };
}
