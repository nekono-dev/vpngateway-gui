// 責務: Gateway UDS の所有権・stale socket 判定・終了処理を検証する。
import { createServer, get as httpGet, type Server } from "node:http";
import type { Socket } from "node:net";
import { lstatSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listenOnGatewaySocket } from "./server.js";

const temporaryDirectories: string[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];

function createSocketPath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "gateway-socket-test-"));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, "gateway.sock") };
}

function createHttpServer(): Server {
  const server = createServer((_request, response) => response.end("ok"));
  servers.push(server);
  return server;
}

function requestGateway(socketPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpGet({ socketPath, path: "/", agent: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve(body));
    });
    request.once("error", reject);
  });
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  })));
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("listenOnGatewaySocket", () => {
  it("creates a 0600 socket and unlinks it after close", async () => {
    const { path } = createSocketPath();
    const server = createHttpServer();
    const originalUmask = process.umask();
    server.once("listening", () => {
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
    });
    const listener = await listenOnGatewaySocket(server, path, process.getuid?.() ?? 0);

    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(process.umask()).toBe(originalUmask);
    expect(lstatSync(path).uid).toBe(process.getuid?.() ?? 0);
    expect(await requestGateway(path)).toBe("ok");
    await listener.close();
    expect(() => lstatSync(path)).toThrow();

    const restartedServer = createHttpServer();
    const restartedListener = await listenOnGatewaySocket(restartedServer, path, process.getuid?.() ?? 0);
    expect(await requestGateway(path)).toBe("ok");
    await restartedListener.close();
  });

  it("removes a stale socket owned by the expected uid and rebinds", async () => {
    const { path } = createSocketPath();
    const staleServer = createHttpServer();
    await new Promise<void>((resolve) => staleServer.listen(path, resolve));
    const stalePath = `${path}.stale`;
    renameSync(path, stalePath);
    await new Promise<void>((resolve) => staleServer.close(() => resolve()));
    renameSync(stalePath, path);

    const server = createHttpServer();
    const listener = await listenOnGatewaySocket(server, path, process.getuid?.() ?? 0);
    expect(lstatSync(path).isSocket()).toBe(true);
    await listener.close();
  });

  it("refuses an active listener without removing its socket", async () => {
    const { path } = createSocketPath();
    const activeServer = createHttpServer();
    await new Promise<void>((resolve) => activeServer.listen(path, resolve));
    const server = createHttpServer();

    await expect(listenOnGatewaySocket(server, path, process.getuid?.() ?? 0)).rejects.toThrow(/active/i);
    expect(lstatSync(path).isSocket()).toBe(true);
  });

  it("refuses non-socket paths without removing them", async () => {
    const { path } = createSocketPath();
    writeFileSync(path, "keep");
    const server = createHttpServer();

    await expect(listenOnGatewaySocket(server, path, process.getuid?.() ?? 0)).rejects.toThrow(/not a socket/i);
    expect(lstatSync(path).isFile()).toBe(true);
  });

  it("refuses stale sockets owned by a different uid", async () => {
    const { path } = createSocketPath();
    const staleServer = createHttpServer();
    await new Promise<void>((resolve) => staleServer.listen(path, resolve));
    const stalePath = `${path}.stale`;
    renameSync(path, stalePath);
    await new Promise<void>((resolve) => staleServer.close(() => resolve()));
    renameSync(stalePath, path);
    const actualUid = process.getuid?.() ?? 0;
    const server = createHttpServer();

    await expect(listenOnGatewaySocket(server, path, actualUid === 0 ? 1 : 0)).rejects.toThrow(/owner/i);
    expect(lstatSync(path).isSocket()).toBe(true);
  });

  it("refuses to unlink a path replaced after stale judgment", async () => {
    const { path } = createSocketPath();
    const staleServer = createHttpServer();
    await new Promise<void>((resolve) => staleServer.listen(path, resolve));
    const stalePath = `${path}.stale`;
    renameSync(path, stalePath);
    await new Promise<void>((resolve) => staleServer.close(() => resolve()));
    renameSync(stalePath, path);
    const replacement = `${path}.replacement`;
    writeFileSync(replacement, "keep");

    const server = createHttpServer();
    await expect(listenOnGatewaySocket(server, path, process.getuid?.() ?? 0, {
      beforeStaleUnlink: (socketPath) => {
        renameSync(replacement, socketPath);
      },
    })).rejects.toThrow(/changed/i);
    expect(lstatSync(path).isFile()).toBe(true);
    expect(await requestGateway(path).catch(() => "")).toBe("");
  });

  it("close leaves a replacement path that is not its socket inode", async () => {
    const { path } = createSocketPath();
    const server = createHttpServer();
    const listener = await listenOnGatewaySocket(server, path, process.getuid?.() ?? 0);
    const originalPath = `${path}.original`;
    renameSync(path, originalPath);
    writeFileSync(path, "keep");

    await listener.close();

    expect(lstatSync(path).isFile()).toBe(true);
    expect(lstatSync(originalPath).isSocket()).toBe(true);
  });
});
