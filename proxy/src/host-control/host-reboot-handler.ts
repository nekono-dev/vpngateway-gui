// 責務: Gateway UDS のホスト再起動依頼要求を依頼ファイル作成結果へ変換する。

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../lib/http-json.js";
import { requestHostReboot } from "./host-reboot.js";

/** Gateway の再起動依頼要求へ既定の受付結果を返す。 */
export function handleHostRebootRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  onResult?: (result: ReturnType<typeof requestHostReboot>) => void,
): void {
  const result = requestHostReboot();
  onResult?.(result);
  if (result === "requested") sendJson(response, 202, { requested: true });
  else if (result === "already_requested") sendJson(response, 409, { error: "reboot_already_requested" });
  else sendJson(response, 503, { error: "host_control_unavailable" });
}
