// 責務: API サーバの起動時初期化と定期的な Gateway 設定再通知を開始する。

import { getProviders } from "./providers/provider-registry.js";
import { restoreConnectionOnStartup } from "./connection-state/restore-connection.js";
import { notifyCurrentSettings, notifyStartupSettings } from "./settings/settings-notification-queue.js";
import { startApiServer } from "./server.js";

async function main(): Promise<void> {
  const providers = getProviders();
  const app = await startApiServer();
  app.log.info({ providers: providers.map((provider) => provider.id) }, "enabled VPN providers loaded");

  void notifyStartupSettings((error) => {
    app.log.warn({ error }, "failed to push current settings to proxy at startup");
  });
  void restoreConnectionOnStartup(app.log);

  const resyncIntervalMs = Number(process.env.SETTINGS_RESYNC_INTERVAL_MS ?? 10_000);
  setInterval(() => {
    notifyCurrentSettings().catch(() => {
      // 再起動中の一時的な失敗は次の周期に再試行する。
    });
  }, resyncIntervalMs).unref();
}

void main().catch((error: unknown) => {
  console.error("failed to start API server", error);
  process.exitCode = 1;
});
