import { useEffect, useState } from "react";
import { getV1ConnectionLocationsCityIdServers } from "../generated/api/default/default";
import type { GetV1ConnectionLocationsCityIdServers200Item } from "../generated/api/endpoints.schemas";
import { describeApiError, describeThrownError, type ErrorContent } from "../notifications/describe-api-error";

export interface ServerListState {
  servers: GetV1ConnectionLocationsCityIdServers200Item[];
  isLoading: boolean;
  error: ErrorContent | undefined;
}

/** 都市のサーバ一覧を取得する。 */
export function useServerList(cityId: string): ServerListState {
  const [servers, setServers] = useState<GetV1ConnectionLocationsCityIdServers200Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ErrorContent>();

  useEffect(() => {
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
  }, [cityId]);

  return { servers, isLoading, error };
}
