// 責務: 接続先一覧（`GET /v1/connection/locations`）の取得状態と、お気に入りの登録/解除、
// 接続成功後の「前回」表示の更新を管理する。API呼び出しは生成クライアントのみを使う。
// 取得は画面表示時と`refresh()`（再計測）のときだけ行う（ポーリングしない。webserver/design.md「取得のタイミング」）。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteV1ConnectionLocationsLocationIdFavorite,
  getV1ConnectionLocations,
  putV1ConnectionLocationsLocationIdFavorite,
} from "../generated/api/default/default";
import type { LocationItem } from "../locations/location-filter";
import { describeApiError, describeThrownError, type ErrorContent } from "../notifications/describe-api-error";
import { useToast } from "../notifications/ToastProvider";

export interface LocationsState {
  // 初回取得中（一覧が空でスピナー相当を出す状態）。再計測中は一覧を残したままisRefreshingだけがtrueになる。
  isLoading: boolean;
  isRefreshing: boolean;
  locations: LocationItem[];
  // 直近の取得が失敗した場合のみ。失敗時は古い一覧を残さない（接続操作を許さないため）。
  error: ErrorContent | undefined;
  refresh: () => void;
  setFavorite: (locationId: string, favorite: boolean) => Promise<void>;
  markLastConnected: (locationId: string) => void;
}

/**
 * 目的: 接続先一覧の取得・再取得・お気に入り更新を提供する。
 * 出力: LocationsState。`refresh`は取得中の重複呼び出しを無視する。`setFavorite`は楽観的に一覧へ反映し
 *       （並び順を変えないため再取得しない）、APIエラー時は元へ戻してトーストで通知する。
 * 副作用: マウント時に一覧を1回取得する。取得中は再取得しない（応答の順序逆転が起きないようにするため）。
 */
export function useLocations(): LocationsState {
  const { notifyError } = useToast();
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [error, setError] = useState<ErrorContent>();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRefreshing(true);
    try {
      const response = await getV1ConnectionLocations();
      if (response.status === 200) {
        setLocations(response.data);
        setError(undefined);
      } else {
        setLocations([]);
        setError(describeApiError(response.status, response.data, "接続先の取得に失敗しました"));
      }
    } catch (caughtError) {
      setLocations([]);
      setError(describeThrownError(caughtError, "接続先の取得に失敗しました"));
    } finally {
      inFlight.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchFavorite = useCallback((locationId: string, favorite: boolean) => {
    setLocations((current) =>
      current.map((location) => (location.id === locationId ? { ...location, favorite } : location)),
    );
  }, []);

  const setFavorite = useCallback(
    async (locationId: string, favorite: boolean) => {
      const operation = favorite ? "お気に入りへの追加" : "お気に入りの解除";
      patchFavorite(locationId, favorite);
      try {
        const response = favorite
          ? await putV1ConnectionLocationsLocationIdFavorite(locationId)
          : await deleteV1ConnectionLocationsLocationIdFavorite(locationId);
        if (response.status !== 200) {
          patchFavorite(locationId, !favorite);
          notifyError(describeApiError(response.status, response.data, `${operation}に失敗しました`));
        }
      } catch (caughtError) {
        patchFavorite(locationId, !favorite);
        notifyError(describeThrownError(caughtError, `${operation}に失敗しました`));
      }
    },
    [notifyError, patchFavorite],
  );

  const markLastConnected = useCallback((locationId: string) => {
    setLocations((current) =>
      current.map((location) => ({ ...location, lastConnected: location.id === locationId })),
    );
  }, []);

  return { isLoading, isRefreshing, locations, error, refresh: () => void load(), setFavorite, markLastConnected };
}
