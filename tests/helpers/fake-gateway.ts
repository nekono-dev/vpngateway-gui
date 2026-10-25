// 責務: APIサーバの受け入れテスト用の、ゲートウェイ制御チャネル（相互TLS）の代役。
// ネットワークコンテナ（`/net/*`）とランナー（`/runners/<ID>/*`）の応答を、テストが与えた関数で返し、受け取った要求を記録する。
// 本物と同じく、クライアント証明書を必須にする（証明書の無い接続・別の認証局の証明書の接続は確立しない）。

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { TestPki } from "./pki.js";

export interface RecordedRequest {
  method: string;
  path: string;
  /** JSONとして解釈できた本文。本文が無い・JSONでない場合はundefined。 */
  body: Record<string, unknown> | undefined;
}

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface FakeGatewayHandlers {
  /** ランナーの `POST /exec`。ベンダーIDと要求本文を受けて、CLIの実行結果を返す。 */
  exec?: (vendorId: string, body: Record<string, unknown>) => CliResult | Promise<CliResult>;
  /** ランナーの `GET /health` に応答するか。falseのベンダーは502を返す。遅延させたいときは数値（ミリ秒）。 */
  health?: (vendorId: string) => boolean | number;
  /** `/net/*` の応答。既定は各エンドポイントの正常応答。 */
  net?: (method: string, path: string, body: Record<string, unknown> | undefined) => { status: number; json: unknown } | undefined;
}

export interface FakeGateway {
  port: number;
  requests: RecordedRequest[];
  handlers: FakeGatewayHandlers;
  close: () => Promise<void>;
}

const defaultStatus = {
  transparentGateway: { state: "active", vpnInterface: "tun0", killSwitchBlocking: false },
  explicitProxy: { state: "stopped", restartCount: 0 },
};

/**
 * 目的: ゲートウェイの代役を起動する。
 * 入力: pki（サーバ証明書とクライアントを検証する認証局を含む証明書一式）, handlers（応答の定義。後から書き換えられる）。
 * 出力: 待受ポート・記録した要求・停止関数。
 */
export async function startFakeGateway(pki: TestPki, handlers: FakeGatewayHandlers = {}): Promise<FakeGateway> {
  const requests: RecordedRequest[] = [];
  const gateway: FakeGateway = { port: 0, requests, handlers, close: async () => undefined };
  const server: Server = createServer(
    {
      ca: readFileSync(pki.caCert),
      cert: readFileSync(pki.serverCert),
      key: readFileSync(pki.serverKey),
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void respond(req.method ?? "GET", req.url ?? "/", Buffer.concat(chunks).toString("utf8"));
      });

      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };

      async function respond(method: string, path: string, text: string): Promise<void> {
        let body: Record<string, unknown> | undefined;
        try {
          body = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : undefined;
        } catch {
          body = undefined;
        }
        requests.push({ method, path, body });
        const runner = /^\/runners\/([a-z0-9-]+)(\/.+)$/.exec(path);
        if (runner !== null) {
          const [, vendorId, runnerPath] = runner as unknown as [string, string, string];
          if (runnerPath === "/health") {
            const health = handlers.health?.(vendorId) ?? true;
            if (typeof health === "number") await new Promise((resolve) => setTimeout(resolve, health));
            if (health === false) return send(502, { error: "runner_unavailable" });
            return send(200, { ok: true });
          }
          if (runnerPath === "/exec" && body !== undefined && handlers.exec !== undefined) {
            return send(200, await handlers.exec(vendorId, body));
          }
          return send(404, { error: "not_found" });
        }
        const custom = handlers.net?.(method, path, body);
        if (custom !== undefined) return send(custom.status, custom.json);
        if (method === "POST" && path === "/net/settings") return send(200, { applied: true });
        if (method === "GET" && path === "/net/status") return send(200, defaultStatus);
        if (method === "POST" && path === "/net/connection-checks") return send(200, { checked: true });
        if (method === "POST" && path === "/net/host-reboot") return send(202, { requested: true });
        return send(404, { error: "not_found" });
      }
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  gateway.port = (server.address() as AddressInfo).port;
  gateway.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return gateway;
}
