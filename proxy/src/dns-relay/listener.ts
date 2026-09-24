// 責務: DNS中継リゾルバのUDP/TCP待受。受け取った問い合わせを`handler`へ渡し、返った応答を送り返す。
// 問い合わせの中身の処理（照合・上流転送）はrelay.tsが担い、本ファイルはソケットの入出力に徹する。

import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server, type Socket as TcpSocket } from "node:net";
import { parseQuery, truncateForUdp, udpLimitFor } from "./dns-message.js";

// 応答を返さない場合はundefined（不正な問い合わせ等）。
export type QueryHandler = (query: Buffer, clientIp: string) => Promise<Buffer | undefined>;

const TCP_IDLE_TIMEOUT_MS = 10_000;

function listenUdp(address: string, port: number, handler: QueryHandler): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.on("message", (message, remote) => {
      handler(message, remote.address)
        .then((response) => {
          if (response === undefined) return;
          const question = parseQuery(message);
          const limited = question === undefined ? response : truncateForUdp(response, question, udpLimitFor(question));
          socket.send(limited, remote.port, remote.address);
        })
        .catch(() => {
          // 応答を返せない場合はクライアントの再試行に任せる。
        });
    });
    socket.once("error", reject);
    socket.bind(port, address, () => {
      socket.removeListener("error", reject);
      socket.on("error", () => undefined);
      resolve(socket);
    });
  });
}

function handleTcpConnection(socket: TcpSocket, handler: QueryHandler): void {
  socket.setTimeout(TCP_IDLE_TIMEOUT_MS, () => socket.destroy());
  socket.on("error", () => socket.destroy());
  let pending = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
      const length = pending.readUInt16BE(0);
      const query = pending.subarray(2, 2 + length);
      pending = pending.subarray(2 + length);
      handler(Buffer.from(query), socket.remoteAddress ?? "")
        .then((response) => {
          if (response === undefined || socket.destroyed) return;
          const frame = Buffer.alloc(2 + response.length);
          frame.writeUInt16BE(response.length, 0);
          response.copy(frame, 2);
          socket.write(frame);
        })
        .catch(() => socket.destroy());
    }
  });
}

function listenTcp(address: string, port: number, handler: QueryHandler): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => handleTcpConnection(socket, handler));
    server.once("error", reject);
    server.listen(port, address, () => {
      server.removeListener("error", reject);
      server.on("error", () => undefined);
      resolve(server);
    });
  });
}

export class DnsListener {
  private sockets: Socket[] = [];
  private servers: Server[] = [];

  /**
   * 目的: 指定アドレスすべてでUDPとTCPのlistenを開始する。
   * 入力: addresses(待ち受けるIPv4アドレス), port(ポート), handler(問い合わせの処理)。
   * 出力: すべてのlistenが成功した時点で解決するPromise。
   * 失敗時の方針: 1つでも失敗した（ポート衝突等）場合は、開いたものをすべて閉じて例外を投げる。
   */
  async start(addresses: readonly string[], port: number, handler: QueryHandler): Promise<void> {
    try {
      for (const address of addresses) {
        this.sockets.push(await listenUdp(address, port, handler));
        this.servers.push(await listenTcp(address, port, handler));
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const sockets = this.sockets;
    const servers = this.servers;
    this.sockets = [];
    this.servers = [];
    await Promise.all([
      ...sockets.map((socket) => new Promise<void>((resolve) => socket.close(() => resolve()))),
      ...servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    ]);
  }
}
