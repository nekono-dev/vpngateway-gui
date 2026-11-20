// 責務: 内部専用HTTPサーバ（UDS上）のJSON入出力の定型処理（リクエストボディの読み取り・JSON応答）。
// Node.js組み込みモジュールとプリミティブ値のみに依存する汎用ヘルパー（ネットワークコンテナ・ランナー共通）。

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 目的: リクエストボディを最大4秒読み、UTF-8文字列として返す。切断・異常終了・期限切れで待ち続けない。
 * 入力: req(受信リクエスト)、timeoutMs(読み取り期限。APIの設定通知期限5秒を超えない)。
 * 出力: ボディ全体のUTF-8文字列。
 */
export function readRequestBody(req: IncomingMessage, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(readTimer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onClose);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (chunk: Buffer): void => { chunks.push(chunk); };
    const onEnd = (): void => finish();
    const onError = (error: Error): void => finish(error);
    const onAborted = (): void => finish(new Error("request body was aborted"));
    const onClose = (): void => {
      if (!req.complete) finish(new Error("request closed before body completed"));
    };
    const readTimer = setTimeout(() => finish(new Error("request body read timed out")), timeoutMs);

    if (req.aborted || (req.destroyed && !req.complete)) {
      finish(new Error("request body was aborted"));
      return;
    }
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    req.on("close", onClose);
  });
}

/**
 * 目的: JSON応答を返す。
 * 入力: res(応答), statusCode(HTTPステータス), body(JSON化できる値)。
 * 出力: なし（副作用として応答を書き込んで終了する）。
 * 例: sendJson(res, 200, { ok: true })
 */
export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(payload);
}
