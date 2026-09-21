// 責務: APIサーバのエントリポイント。buildApp()で構築したアプリをHTTPで待ち受ける。

import { buildApp } from "./app.js";
import { getSettings } from "./settings/settings-store.js";
import { notifySettings } from "./proxy-client/proxy-client.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});

// プロキシコンテナは自身の設定を永続化せず、`POST /settings`による通知でのみ現在の
// killSwitch/transparentGatewayEnabled等を知る（proxyserver/design.md「内部プロトコル拡張」参照）。
// そのため、プロキシコンテナのみが再作成された場合（APIコンテナは再作成されない場合）、
// 次にユーザが設定を変更するまでプロキシ側が永続化済みの設定を反映できない空白期間が生じうる。
// これを緩和するため、APIサーバ起動時に現在の永続化済み設定を通知する（加えて下記の定期再通知も行う）
// （起動順序（proxy→api、docker-compose.yml参照）によりproxy側のソケットlisten未完了と競合しうるため、
// 数回リトライする。最終的に失敗してもAPIサーバの起動自体は妨げない）。
async function pushCurrentSettingsToProxy(): Promise<void> {
  const settings = getSettings();
  const retryDelaysMs = [500, 1000, 2000];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      await notifySettings(settings);
      return;
    } catch (error) {
      if (attempt === retryDelaysMs.length) {
        app.log.warn({ error }, "failed to push current settings to proxy at startup");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }
}

void pushCurrentSettingsToProxy();

// proxyコンテナ単体の再起動・再作成（APIは動き続ける）や、proxy側でのVPNデーモン消滅に追従するため、
// 現在の設定を定期的に再通知する。通知は冪等（proxy側は受信のたびに全撤去→再適用）であり、
// proxy不在中の失敗は無視して次周期で再試行する。これが無いと、proxyのみの再起動後、次にユーザが
// 設定を変更するまでKill Switchのnftルールが再構成されない（実機検証で確認）。
const SETTINGS_RESYNC_INTERVAL_MS = Number(process.env.SETTINGS_RESYNC_INTERVAL_MS ?? 10_000);
setInterval(() => {
  notifySettings(getSettings()).catch(() => {
    // proxy再起動中などの一時的な失敗。次周期で再試行する。
  });
}, SETTINGS_RESYNC_INTERVAL_MS).unref();
