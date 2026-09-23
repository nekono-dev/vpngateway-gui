// 責務: `/runners/<ベンダーID>/*`宛のリクエストを、対応するランナーのUDS（`runner-<ベンダーID>.sock`）へ
// 転送する。proxyserver/design.md「ゲートウェイ制御チャネル」: proxy⇄runner間は同一ホスト常在の前提が
// 変わらないため、従来どおり共有Dockerボリューム上のUDSを使う（api⇄proxy間のみmTLS TCP化した）。

import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { sendJson } from "../lib/http-json.js";

// 呼び出しごとに読む（テストで切り替えるため。api/src/providers/provider-state-paths.tsと同方針）。
function socketDir(): string {
  return process.env.CTL_SOCKET_DIR ?? "/var/run/vpngw-ctl";
}

// ベンダーIDはprovider-registry側で英数字・ハイフンのみに制限されている（api/apiserver/design.md）。
// ここでも同じ形式のみを許可し、パス経由でソケットディレクトリ外を指させない。
const RUNNER_PATH_PATTERN = /^\/runners\/([a-z0-9-]+)(\/.+)$/;

interface RunnerTarget {
  vendorId: string;
  runnerPath: string;
}

/**
 * 目的: リクエストURLが`/runners/<ベンダーID>/*`形式かを判定し、転送先を取り出す。
 * 入力: url(リクエストの`req.url`)。
 * 出力: 一致すれば{ vendorId, runnerPath }、しなければundefined。
 * 例: matchRunnerPath("/runners/vendora/exec") // => { vendorId: "vendora", runnerPath: "/exec" }
 */
export function matchRunnerPath(url: string | undefined): RunnerTarget | undefined {
  if (!url) return undefined;
  const match = RUNNER_PATH_PATTERN.exec(url);
  if (!match) return undefined;
  return { vendorId: match[1], runnerPath: match[2] };
}

/**
 * 目的: リクエストを、指定したベンダーのランナーのUDSへそのまま転送する（ヘッダ・ボディ・応答を中継）。
 * 入力: vendorId(転送先ランナーのベンダーID), runnerPath(ランナー側のパス。例 "/exec"・"/health"),
 *      req(受信リクエスト), res(応答先)。
 * 出力: なし（副作用としてresへランナーの応答を書き込む）。
 * 失敗時の方針: 対応するソケットが無い・接続できない場合は502（proxyserver/design.md「パスでルーティング」）。
 */
export function forwardToRunner(vendorId: string, runnerPath: string, req: IncomingMessage, res: ServerResponse): void {
  const socketPath = join(socketDir(), `runner-${vendorId}.sock`);
  const forwardedReq = httpRequest({ socketPath, path: runnerPath, method: req.method, headers: req.headers }, (runnerRes) => {
    res.writeHead(runnerRes.statusCode ?? 502, runnerRes.headers);
    runnerRes.pipe(res);
  });
  forwardedReq.on("error", () => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: "runner_unavailable" });
    } else {
      res.destroy();
    }
  });
  req.pipe(forwardedReq);
}
