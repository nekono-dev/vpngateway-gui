// 責務: 接続・操作履歴（`GET /v1/connection/log`）をモーダルダイアログで新しい順に表示する。
// 履歴の書き込みはAPIサーバが行う（apiserver/design.md「監査ログ」）。ここでは表示のみを行う。
// エラーはダイアログ内に表示する（モーダル表示中はダイアログ外のトーストが操作不能になるため）。

import { useCallback, useEffect, useState } from "react";
import { getV1ConnectionLog } from "../../generated/api/default/default";
import type { GetV1ConnectionLog200Item } from "../../generated/api/endpoints.schemas";
import { useDialogOpen } from "../../hooks/useDialogOpen";
import { describeApiError, describeThrownError } from "../../notifications/describe-api-error";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  connect: "接続",
  disconnect: "切断",
  login: "ログイン",
};

/**
 * 目的: 監査ログ1件の`input`から接続先を表示用に取り出す。connect時は`{ connect, locationId }`
 *       （Phase 8以降。例 "us-las-vegas"）、Phase 8より前の履歴は`{ connect, country }`が入る。
 * 入力: input(APIレスポンスのinputフィールド。unknown)。
 * 期待する入力形状: `{ locationId?: string, country?: string }`。それ以外（undefined等）は接続先なしとして扱う。
 * 出力: locationIdがあれば「国コード大文字 / 都市（slugのハイフンを空白へ）」、無ければ大文字化した国コード。取り出せなければundefined。
 * 例: extractLocation({ connect: true, locationId: "us-las-vegas" }) // => "US / las vegas"
 *     extractLocation({ connect: true, country: "jp" }) // => "JP"
 */
function extractLocation(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { locationId, country } = input as Record<string, unknown>;
  if (typeof locationId === "string" && locationId.length > 0) {
    const [iso, ...cityParts] = locationId.split("-");
    return cityParts.length > 0 ? `${iso.toUpperCase()} / ${cityParts.join(" ")}` : iso.toUpperCase();
  }
  return typeof country === "string" && country.length > 0 ? country.toUpperCase() : undefined;
}

/**
 * 目的: 実行結果（exitCode/error）の表示文字列を返す。
 * 入力: entry(監査ログ1件)。
 * 出力: exitCode=0は「成功」、非0は「失敗 (exit N)」、exitCode無しでerrorがあれば「失敗」、どちらも無ければ「-」。
 */
function describeResult(entry: GetV1ConnectionLog200Item): { label: string; ok: boolean } {
  if (entry.exitCode === 0) return { label: "成功", ok: true };
  if (entry.exitCode !== undefined) return { label: `失敗 (exit ${entry.exitCode})`, ok: false };
  if (entry.error) return { label: "失敗", ok: false };
  return { label: "-", ok: true };
}

export function ConnectionLogDialog({ open, onClose }: Props) {
  const dialogRef = useDialogOpen(open);
  const [entries, setEntries] = useState<GetV1ConnectionLog200Item[]>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await getV1ConnectionLog();
      if (response.status !== 200) {
        setError(describeApiError(response.status, response.data, "履歴の取得に失敗しました").summary);
        return;
      }
      // APIは記録順（古い順）で返すため、新しい順に並べ替えて表示する。
      setEntries([...response.data].reverse());
    } catch (caughtError) {
      setError(describeThrownError(caughtError, "履歴の取得に失敗しました").summary);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-label="接続ログ">
      <h2>接続ログ</h2>
      {error ? <p role="alert">{error}</p> : null}
      {isLoading && !entries ? <p>読み込み中...</p> : null}
      {entries && entries.length === 0 ? <p>履歴はありません。</p> : null}
      {entries && entries.length > 0 ? (
        <div className="log-scroll">
          <table className="log-table">
            <thead>
              <tr>
                <th scope="col">日時</th>
                <th scope="col">操作</th>
                <th scope="col">接続先</th>
                <th scope="col">結果</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const result = describeResult(entry);
                return (
                  <tr key={`${entry.timestamp}-${index}`}>
                    <td>{new Date(entry.timestamp).toLocaleString("ja-JP")}</td>
                    <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td>{extractLocation(entry.input) ?? "-"}</td>
                    <td className={result.ok ? "log-ok" : "log-ng"}>{result.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" disabled={isLoading} onClick={() => void load()}>
          再読み込み
        </button>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
