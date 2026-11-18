// 責務: Gateway 制御用 Unix domain socket の単一所有と安全な起動・終了を管理する。
import { chmodSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { connect } from "node:net";

const SOCKET_MODE = 0o600;
const PROBE_TIMEOUT_MS = 500;

interface SocketIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
}

export interface GatewaySocketListener {
  close(): Promise<void>;
}

export interface GatewaySocketHooks {
  readonly beforeStaleUnlink?: (socketPath: string) => void;
}

function readSocketIdentity(path: string): SocketIdentity {
  const stat = lstatSync(path);
  if (!stat.isSocket()) throw new Error("Gateway socket path is not a socket");
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid };
}

function sameSocket(path: string, identity: SocketIdentity): boolean {
  try {
    const current = readSocketIdentity(path);
    return current.dev === identity.dev && current.ino === identity.ino && current.uid === identity.uid;
  } catch {
    return false;
  }
}

function probeSocket(path: string): Promise<"active" | "stale"> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let settled = false;
    const finish = (result: "active" | "stale" | Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(new Error("Gateway socket probe timed out")));
    socket.once("connect", () => finish("active"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") finish("stale");
      else finish(error);
    });
  });
}

/** Gateway UDS を所有して待受を開始し、終了時は同じ socket inode だけを除去する。 */
export async function listenOnGatewaySocket(
  server: Server,
  socketPath: string,
  expectedUid: number,
  hooks: GatewaySocketHooks = {},
): Promise<GatewaySocketListener> {
  try {
    readSocketIdentity(socketPath);
    const probe = await probeSocket(socketPath);
    if (probe === "active") throw new Error("Gateway socket already has an active listener");

    const stale = readSocketIdentity(socketPath);
    if (stale.uid !== expectedUid) throw new Error("Gateway stale socket owner does not match expected uid");
    hooks.beforeStaleUnlink?.(socketPath);
    // 親 directory は entrypoint が 0700 で proxy 所有にし、別 UID からの再確認後の差し替えを防ぐ。
    if (!sameSocket(socketPath, stale)) throw new Error("Gateway stale socket path changed before unlink");
    unlinkSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const previousUmask = process.umask(0o177);
  await new Promise<void>((resolve, reject) => {
    let restored = false;
    const restoreUmask = (): void => {
      if (restored) return;
      restored = true;
      process.umask(previousUmask);
    };
    const onError = (error: Error): void => {
      restoreUmask();
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      restoreUmask();
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(socketPath);
    } catch (error) {
      restoreUmask();
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
      reject(error);
    }
  });

  try {
    chmodSync(socketPath, SOCKET_MODE);
    const identity = readSocketIdentity(socketPath);
    if (identity.uid !== expectedUid) throw new Error("Gateway socket owner does not match expected uid");
    return {
      close: async () => {
        let displacedPath: string | undefined;
        try {
          lstatSync(socketPath);
          displacedPath = `${socketPath}.closing-${process.pid}-${randomUUID()}`;
          renameSync(socketPath, displacedPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }

        let closeError: Error | undefined;
        await new Promise<void>((resolve) => {
          server.close((error) => {
            closeError = error ?? undefined;
            resolve();
          });
        });

        if (displacedPath !== undefined) {
          if (sameSocket(displacedPath, identity)) {
            unlinkSync(displacedPath);
          } else {
            try {
              lstatSync(socketPath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") renameSync(displacedPath, socketPath);
              else throw error;
            }
          }
        }
        if (closeError !== undefined) throw closeError;
      },
    };
  } catch (error) {
    await new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    throw error;
  }
}
