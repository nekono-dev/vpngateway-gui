// 責務: ランナーの`POST /exec`（解決済みコマンドの実行要求）の検証・許可判定・実行・応答。
// 許可判定は自ベンダーのバイナリ1つだけ（allowlist.ts）。ネットワークの状態は持たない（Phase 11でネットワーク
// コンテナから分離。接続・切断後のゲートウェイルール再構成はAPIがネットワークコンテナへ通知する）。

import type { IncomingMessage, ServerResponse } from "node:http";
import { isAllowedBinary } from "../allowlist.js";
import { runCommand, runDetachableCommand } from "./command-runner.js";
import { logAuditEvent } from "../lib/audit-event.js";
import { readRequestBody, sendJson } from "../lib/http-json.js";

// 内部プロトコルのリクエスト形状（OpenAPI非公開）。apiserver/design.md「プロキシとの内部通信仕様」参照。
export interface ExecRequestBody {
  vendor: string;
  binary: string;
  resolvedArgv: string[];
  timeoutMs: number;
  // 設定されている場合、プロセスの終了を待たずstdoutがこの正規表現(文字列)に一致した時点で応答し、
  // プロセスはバックグラウンドで実行継続させる（`login`アクション用、command-runner.ts参照）。
  completionPattern?: string;
  // 設定されている場合、子プロセスの標準入力へ書き込んで閉じる（ユーザー名・パスワード入力型のログイン用）。
  // 秘密情報を含みうるため内容はログへ出さない（有無のみ記録する）。completionPatternとは併用できない
  // （その場合は無視する。バックグラウンド継続する`login`はURL提示型のみで入力を要しないため）。
  stdin?: string;
}

// stdinの最大バイト数。想定外の巨大な入力でプロセス・メモリを消費させないための上限
// （パスワード最大512文字＋2FAコード程度で足りる）。
const MAX_STDIN_BYTES = 4096;

/**
 * 目的: unknownな入力(JSONパース結果)がExecRequestBodyの最小要件を満たすかを検証する。
 * 入力: JSON.parse()の戻り値（unknown）。
 * 出力: 形状が正しければ true（TypeScriptの型ガードとしても機能する）。
 * 期待する入力形状: vendor/binaryが非空文字列、resolvedArgvが文字列配列、timeoutMsが正の数値、
 *                completionPatternは省略可能だが指定時は文字列。stdinは省略可能だが指定時は
 *                MAX_STDIN_BYTES以下の文字列。
 */
export function isValidExecRequestBody(value: unknown): value is ExecRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.vendor === "string" &&
    body.vendor.length > 0 &&
    typeof body.binary === "string" &&
    body.binary.length > 0 &&
    Array.isArray(body.resolvedArgv) &&
    body.resolvedArgv.every((item) => typeof item === "string") &&
    typeof body.timeoutMs === "number" &&
    body.timeoutMs > 0 &&
    (body.completionPattern === undefined || typeof body.completionPattern === "string") &&
    (body.stdin === undefined || (typeof body.stdin === "string" && Buffer.byteLength(body.stdin, "utf8") <= MAX_STDIN_BYTES))
  );
}

/**
 * 目的: `POST /exec`を処理する（検証→許可判定→実行→応答）。
 * 入力: req/res(HTTPリクエスト・応答)。
 * 出力: なし（副作用として応答を返し、監査ログを記録する）。
 * 失敗時の方針: JSON不正・形状不正は400、許可リスト外は403。実行自体の失敗（非ゼロ終了・タイムアウト）は
 *              200でexitCodeに載せる（呼び出し元が422/504へ振り分ける）。
 */
export async function handleExec(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  if (!isValidExecRequestBody(parsed)) {
    sendJson(res, 400, { error: "invalid_request_shape" });
    return;
  }

  // 内部防御: APIコンテナが将来侵害・バグ混入した場合でも、任意コマンド実行の踏み台にならないための最後の防波堤。
  if (!isAllowedBinary(parsed.binary)) {
    logAuditEvent({ event: "exec_rejected", reason: "binary_not_allowed", binary: parsed.binary });
    sendJson(res, 403, { error: "binary_not_allowed" });
    return;
  }

  const result = parsed.completionPattern
    ? await runDetachableCommand(parsed.binary, parsed.resolvedArgv, parsed.timeoutMs, parsed.completionPattern, {
        // バックグラウンド継続後の最終的な終了（自然終了・強制kill問わず）を監査ログに残す。
        // 呼び出し元へのレスポンスは既に返却済みのため、ここでは別途ログ出力のみ行う。
        onBackgroundExit: (info) => {
          logAuditEvent({
            event: "background_exec_completed",
            vendor: parsed.vendor,
            binary: parsed.binary,
            argv: parsed.resolvedArgv,
            exitCode: info.exitCode,
            killedByTimeout: info.killedByTimeout,
          });
        },
      })
    : await runCommand(parsed.binary, parsed.resolvedArgv, parsed.timeoutMs, { stdin: parsed.stdin });
  // stdinは秘密情報（パスワード等）を含みうるため、内容は記録せず有無のみ残す。
  logAuditEvent({
    event: "exec_completed",
    vendor: parsed.vendor,
    binary: parsed.binary,
    argv: parsed.resolvedArgv,
    exitCode: result.exitCode,
    ...(parsed.stdin !== undefined ? { stdinProvided: true } : {}),
  });
  sendJson(res, 200, result);
}
