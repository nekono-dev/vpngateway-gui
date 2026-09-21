// 責務: APIのエラーレスポンス（HTTPステータス＋ErrorResponse本文）や例外を、トースト表示用の
// 「要約（通常表示）」と「詳細（折りたたみ表示）」へ変換する。stderr等の生ログは詳細側にのみ入れる。
// エラー種別→意味づけは apiserver/design.md「エラーハンドリング方針」に対応する。

export interface ErrorContent {
  summary: string;
  detail?: string;
}

/**
 * 目的: 生成クライアントが返す非2xxレスポンスをErrorContentへ変換する。
 * 入力: status(HTTPステータス), data(レスポンス本文。unknown), fallback(失敗した操作名を含む既定の要約。例: "接続に失敗しました")。
 * 期待する入力形状(data): `{ error?: string, message?: string, exitCode?: number, stderr?: string }`（すべて任意）。
 *                       形状が異なる場合（HTML等）は本文を無視しfallbackとステータスのみで組み立てる。
 * 出力: ErrorContent。detailは、stderr → message の順で最初に得られたもの（無ければ省略）。
 * 例: describeApiError(422, { error: "command_failed", exitCode: 1, stderr: "..." }, "接続に失敗しました")
 *     // => { summary: "接続に失敗しました（VPNコマンドが異常終了: exit code 1）", detail: "..." }
 */
export function describeApiError(status: number, data: unknown, fallback: string): ErrorContent {
  const body = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const message = typeof body.message === "string" ? body.message : undefined;
  const stderr = typeof body.stderr === "string" && body.stderr.trim().length > 0 ? body.stderr : undefined;
  const exitCode = typeof body.exitCode === "number" ? body.exitCode : undefined;
  const detail = stderr ?? message;

  switch (status) {
    case 400:
      return { summary: `${fallback}（入力が不正です）`, detail };
    case 403:
      // プラン制限による失敗（operation_restricted）。通常の実行失敗と区別して、原因が契約プランであることを示す。
      return { summary: `${fallback}（現在のプランでは利用できない操作です）`, detail };
    case 501:
      return { summary: `${fallback}（このVPNプロバイダでは利用できない操作です）`, detail };
    case 422:
      return {
        summary: `${fallback}（VPNコマンドが異常終了${exitCode !== undefined ? `: exit code ${exitCode}` : ""}）`,
        detail,
      };
    case 502:
      return { summary: `${fallback}（プロキシサーバに接続できません）`, detail };
    case 504:
      return { summary: `${fallback}（プロキシサーバの応答がタイムアウトしました）`, detail };
    default:
      return { summary: `${fallback} (status: ${status})`, detail };
  }
}

/**
 * 目的: fetch自体の失敗（ネットワーク断・APIサーバ停止等）を含む例外をErrorContentへ変換する。
 * 入力: error(catchした値。unknown), fallback(既定の要約)。
 * 出力: ErrorContent。Errorのmessageは詳細側へ入れる。
 * 例: describeThrownError(new TypeError("Failed to fetch"), "接続に失敗しました")
 */
export function describeThrownError(error: unknown, fallback: string): ErrorContent {
  const message = error instanceof Error ? error.message : String(error);
  return { summary: `${fallback}（APIサーバに接続できません）`, detail: message };
}
