// 責務: Unixドメインソケット上でHTTPサーバをlistenする際の定型処理（残存ソケット除去・パーミッション制限）。
// Node.js組み込みモジュールとプリミティブ値のみに依存する汎用ヘルパー。

import { existsSync, unlinkSync, chmodSync } from "node:fs";
import type { Server } from "node:http";

/**
 * 目的: 指定パスの残存ソケットファイルを削除してからHTTPサーバをlistenし、
 *       listen完了後にソケットファイルのパーミッションを制限する。
 * 入力: server(listen対象のhttp.Server), socketPath(UDSファイルパス), mode(chmodSyncに渡す8進数パーミッション)。
 * 出力: listen完了時に解決するPromise。
 * 例: await listenOnUnixSocket(server, "/var/run/vpngw-ctl/exec.sock", 0o770)
 * 失敗時の方針: 前回異常終了時のソケットファイル残骸による EADDRINUSE を防ぐため、
 *              listen前に既存ファイルを無条件でunlinkする（他プロセスが使用中のソケットは想定しない）。
 */
export function listenOnUnixSocket(server: Server, socketPath: string, mode: number): Promise<void> {
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }
  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      // Node.jsのlisten()はソケットファイルのパーミッションを引き継がないため明示的に設定する。
      chmodSync(socketPath, mode);
      resolve();
    });
  });
}
