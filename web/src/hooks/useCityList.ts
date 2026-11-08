import { useCallback, useEffect, useRef, useState } from "react";
import { getV1ConnectionLocationsCountryCities, postV1ConnectionLocationsCountryCitiesRefresh } from "../generated/api/default/default";
import type { GetV1ConnectionLocationsCountryCities200Item } from "../generated/api/endpoints.schemas";
import { describeApiError, describeThrownError, type ErrorContent } from "../notifications/describe-api-error";

export interface CityListState {
  cities: GetV1ConnectionLocationsCountryCities200Item[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: ErrorContent | undefined;
  refresh: () => Promise<void>;
  patchFavorite: (cityId: string, favorite: boolean) => void;
}

/** 国の都市一覧を取得し、明示的な再取得時のみベンダーの一覧を更新する。 */
export function useCityList(country: string): CityListState {
  const [cities, setCities] = useState<GetV1ConnectionLocationsCountryCities200Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ErrorContent>();
  const requestId = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const currentRequestId = ++requestId.current;
    setIsRefreshing(true);
    setError(undefined);
    try {
      const response = refresh
        ? await postV1ConnectionLocationsCountryCitiesRefresh(country)
        : await getV1ConnectionLocationsCountryCities(country);
      if (currentRequestId !== requestId.current) return;
      if (response.status === 200) setCities(response.data);
      else {
        setCities([]);
        setError(describeApiError(response.status, response.data, "都市一覧の取得に失敗しました"));
      }
    } catch (caughtError) {
      if (currentRequestId !== requestId.current) return;
      setCities([]);
      setError(describeThrownError(caughtError, "都市一覧の取得に失敗しました"));
    } finally {
      if (currentRequestId === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [country]);

  useEffect(() => {
    // 国が未選択（国の一覧の画面）のときは取得しない。
    if (!country) return;
    setCities([]);
    setError(undefined);
    setIsLoading(true);
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [country, load]);

  // お気に入りの登録・解除の成功後に、この一覧の☆の表示だけを直す（一覧は取り直さない）。
  const patchFavorite = useCallback((cityId: string, favorite: boolean) => {
    setCities((current) => current.map((city) => (city.id === cityId ? { ...city, favorite } : city)));
  }, []);

  return { cities, isLoading, isRefreshing, error, refresh: () => load(true), patchFavorite };
}
