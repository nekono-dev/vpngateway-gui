// 責務: 起動・周期・PUT 設定通知が API の本番通知関数から Gateway UDS へ届くことを検証する。

import Fastify from "fastify";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let directory: string;
let socketPath: string;
let udsServer: Server | undefined;
let app: ReturnType<typeof Fastify> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (udsServer?.listening) await new Promise<void>((resolve) => udsServer?.close(() => resolve()));
  udsServer = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  delete process.env.GATEWAY_SOCKET_PATH;
  delete process.env.GATEWAY_TLS_ENABLED;
  delete process.env.SETTINGS_FILE;
  vi.resetModules();
});

describe("Gateway 設定通知 UDS integration", () => {
  it("起動通知・周期再同期・PUT 通知を同じ UDS listener へ送る", async () => {
    directory = mkdtempSync(join(tmpdir(), "gateway-settings-notify-"));
    socketPath = join(directory, "gateway.sock");
    process.env.GATEWAY_SOCKET_PATH = socketPath;
    process.env.GATEWAY_TLS_ENABLED = "false";
    process.env.SETTINGS_FILE = join(directory, "settings.json");
    const received: Record<string, unknown>[] = [];
    udsServer = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        expect(request.url).toBe("/net/settings");
        received.push(JSON.parse(body) as Record<string, unknown>);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ succeeded: true, applied: true }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      udsServer?.once("error", reject);
      udsServer?.listen(socketPath, resolve);
    });

    vi.resetModules();
    const notifications = await import("../settings/settings-notification-queue.js");
    const { registerConnectionConfigRoute } = await import("../routes/connection-config.js");
    app = Fastify();
    app.register(registerConnectionConfigRoute);

    await notifications.notifyStartupSettings((error) => { throw error; });
    await notifications.notifyCurrentSettings();
    const update = await app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });

    expect(update.statusCode).toBe(200);
    expect(received).toHaveLength(3);
    expect(received[0]).toMatchObject({ killSwitch: true, transparentGatewayEnabled: true });
    expect(received[1]).toEqual(received[0]);
    expect(received[2]).toMatchObject({ killSwitch: false, transparentGatewayEnabled: true });
  });
});
