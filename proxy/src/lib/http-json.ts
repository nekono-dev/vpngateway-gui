// 責務: 内部専用HTTPサーバ（UDS上）のJSON入出力の定型処理（リクエストボディの読み取り・JSON応答）。
// Node.js組み込みモジュールとプリミティブ値のみに依存する汎用ヘルパー（ネットワークコンテナ・ランナー共通）。

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 目的: リクエストボディを全て読み、UTF-8文字列として返す。
 * 入力: req(受信リクエスト)。
 * 出力: ボディ全体の文字列（ボディなしなら空文字列）。
 * 失敗時の方針: 受信エラーはPromiseのrejectで呼び出し元へ伝える。
 */
export function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
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
