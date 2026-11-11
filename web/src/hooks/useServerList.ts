import { useCallback, useEffect, useState } from "react";
import { getV1ConnectionLocationsCityIdServers } from "../generated/api/default/default";
import type { GetV1ConnectionLocationsCityIdServers200Item } from "../generated/api/endpoints.schemas";
import { describeApiError, describeThrownError, type ErrorContent } from "../notifications/describe-api-error";

export interface ServerListState {
  servers: GetV1ConnectionLocationsCityIdServers200Item[];
  isLoading: boolean;
  error: ErrorContent | undefined;
  patchFavorite: (serverName: string, favorite: boolean) => void;
}

/** 都市のサーバ一覧を取得する。 */
export function useServerList(cityId: string, connectionStatus?: string, connectionLocation?: string): ServerListState {
  const [servers, setServers] = useState<GetV1ConnectionLocationsCityIdServers200Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ErrorContent>();

  useEffect(() => {
    // 都市が未選択のときは取得しない。
    if (!cityId) return;
    let stale = false;
    setServers([]);
    setError(undefined);
    setIsLoading(true);
    getV1ConnectionLocationsCityIdServers(cityId).then((response) => {
      if (stale) return;
      if (response.status === 200) setServers(response.data);
      else setError(describeApiError(response.status, response.data, "サーバ一覧の取得に失敗しました"));
    }).catch((caughtError: unknown) => {
      if (!stale) setError(describeThrownError(caughtError, "サーバ一覧の取得に失敗しました"));
    }).finally(() => {
      if (!stale) setIsLoading(false);
    });
    return () => { stale = true; };
  }, [cityId, connectionStatus, connectionLocation]);

  // お気に入りの登録・解除の成功後に、この一覧の☆の表示だけを直す。
  const patchFavorite = useCallback((serverName: string, favorite: boolean) => {
    setServers((current) => current.map((server) => (server.name === serverName ? { ...server, favorite } : server)));
  }, []);

  return { servers, isLoading, error, patchFavorite };
}
