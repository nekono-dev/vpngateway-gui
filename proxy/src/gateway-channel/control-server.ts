// 責務: Gateway 制御要求のHTTPまたはmTLS HTTPS serverを保護設定に従って生成する。

import { createServer as createHttpServer, type RequestListener, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { loadGatewayTlsOptions } from "./tls-options.js";

/** UDS に接続する唯一の制御serverを、設定に合うHTTP方式で生成する。 */
export function createGatewayChannelServer(
  handler: RequestListener,
  env: NodeJS.ProcessEnv = process.env,
): Server {
  const tlsOptions = loadGatewayTlsOptions(env);
  return tlsOptions === undefined ? createHttpServer(handler) : createHttpsServer(tlsOptions, handler);
}
