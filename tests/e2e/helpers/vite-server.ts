// 責務: 実ブラウザのテスト用に、Webの開発サーバ（Vite）を空きポートで起動・停止する。
// APIへの要求は、ブラウザ側（`page.route`）で差し替えるため、開発サーバの転送先は使わない。

import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";

// Playwrightは、テストのファイルをCommonJSへ変換して実行するため、`__dirname` を使う。
const repoRoot = join(__dirname, "..", "..", "..");

export interface ViteServer {
  url: string;
  stop: () => void;
}

/** 目的: 空いているポート番号を1つ得る。 */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * 目的: Viteの開発サーバを起動し、応答するまで待つ。
 * 出力: 画面のURLと停止関数。起動に失敗したら例外。
 */
export async function startViteServer(): Promise<ViteServer> {
  const port = await freePort();
  const child: ChildProcess = spawn(join(repoRoot, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: join(repoRoot, "web"),
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) break;
    } catch {
      // まだ起動していない。
    }
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      throw new Error("vite dev server did not start");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { url, stop: () => child.kill("SIGTERM") };
}
