// 責務: 接続先一覧（`GET /v1/connection/locations`）の取得状態と、お気に入りの登録/解除、
// 接続成功後の「前回」表示の更新を管理する。API呼び出しは生成クライアントのみを使う。
// 取得は画面表示時と`refresh()`（再計測）のときだけ行う（ポーリングしない）。

import { useCallback, useEffect, useRef, useState } from "react";
import { getV1ConnectionLocations } from "../generated/api/default/default";
import type { GetV1ConnectionLocations200Item } from "../generated/api/endpoints.schemas";
import { describeApiError, describeThrownError, type ErrorContent } from "../notifications/describe-api-error";
import { useToast } from "../notifications/ToastProvider";

export interface LocationsState {
  // 初回取得中（一覧が空でスピナー相当を出す状態）。再計測中は一覧を残したままisRefreshingだけがtrueになる。
  isLoading: boolean;
  isRefreshing: boolean;
  // 国の行の一覧（GET /v1/connection/locations）。都市とサーバは都市の一覧・サーバの一覧で取得する。
  locations: GetV1ConnectionLocations200Item[];
  // 直近の取得が失敗した場合のみ。失敗時は古い一覧を残さない（接続操作を許さないため）。
  error: ErrorContent | undefined;
  refresh: () => void;
  markLastConnected: (locationId: string) => void;
}

/**
 * 目的: 接続先一覧の取得・再取得・お気に入り更新を提供する。
 * 出力: LocationsState。`refresh`は取得中の重複呼び出しを無視する。（お気に入りは App 側で扱う）。
 * 入力: providerId(選択中のベンダーID。変わったら、前のベンダーの一覧・エラー・応答を捨てて取得し直す。Phase 11。
 *       未取得のときはundefined), enabled(取得を行うか。接続先一覧の操作が制限されている・実行可否が未取得の間はfalse。falseの間は
 *       取得せず一覧を空にする。制限されるプロバイダで無駄な取得とエラー表示が出るのを避けるため)。
 * 副作用: enabledがtrueになったとき（マウント時を含む）一覧を1回取得する。取得中は再取得しない
 *        （応答の順序逆転が起きないようにするため）。
 */
export function useLocations(enabled: boolean, providerId?: string): LocationsState {
  const { notifyError } = useToast();
  const [locations, setLocations] = useState<GetV1ConnectionLocations200Item[]>([]);
  const [error, setError] = useState<ErrorContent>();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef(false);
  // ベンダーが替わるたびに増やす世代。古い世代の取得結果（前のベンダーの一覧）が新しい状態を上書きしないようにする。
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedGeneration = generation.current;
    setIsRefreshing(true);
    try {
      const response = await getV1ConnectionLocations();
      if (startedGeneration !== generation.current) return;
      if (response.status === 200) {
        setLocations(response.data);
        setError(undefined);
      } else {
        setLocations([]);
        setError(describeApiError(response.status, response.data, "接続先の取得に失敗しました"));
      }
    } catch (caughtError) {
      if (startedGeneration !== generation.current) return;
      setLocations([]);
      setError(describeThrownError(caughtError, "接続先の取得に失敗しました"));
    } finally {
      // 世代が替わっていれば、この取得の後始末は新しい世代（下のリセットで済ませ済み）に任せる。
      if (startedGeneration === generation.current) {
        inFlight.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    // ベンダーの切替: 前のベンダーの取得を無効にし、一覧・エラーを空へ戻して読み込み中から始める。
    generation.current += 1;
    inFlight.current = false;
    setLocations([]);
    setError(undefined);
    setIsLoading(true);
    setIsRefreshing(false);
  }, [providerId]);

  useEffect(() => {
    if (!enabled) {
      // 制限された（または実行可否が未取得の）間は取得せず、再び有効になったとき最初から読み込み中として扱う。
      setLocations([]);
      setError(undefined);
      setIsLoading(true);
      return;
    }
    void load();
  }, [enabled, providerId, load]);

  const markLastConnected = useCallback((locationId: string) => {
    setLocations((current) =>
      current.map((location) => ({ ...location, lastConnected: location.id === locationId })),
    );
  }, []);

  return { isLoading, isRefreshing, locations, error, refresh: () => void load(), markLastConnected };
}
