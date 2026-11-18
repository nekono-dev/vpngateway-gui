// 責務: 設定更新時の Gateway 通知順序・保存結果・HTTP 応答を検証する。

import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { ProxyTimeoutError, ProxyUnavailableError } from "../errors.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const settingsFile = join(mkdtempSync(join(tmpdir(), "vpngwgui-config-route-")), "settings.json");
process.env.SETTINGS_FILE = settingsFile;

const { notifySettingsMock } = vi.hoisted(() => ({ notifySettingsMock: vi.fn() }));
vi.mock("../proxy-client/proxy-client.js", () => ({ notifySettings: notifySettingsMock }));

const { registerConnectionConfigRoute } = await import("./connection-config.js");
const settingsStore = await import("../settings/settings-store.js");
const { notifyCurrentSettings, notifyStartupSettings, settingsNotificationQueue } = await import("../settings/settings-notification-queue.js");

function buildApp() {
  const app = Fastify();
  app.register(registerConnectionConfigRoute);
  return app;
}

describe("PUT /v1/connection/config", () => {
  beforeEach(() => {
    settingsStore.saveSettings({
      ...settingsStore.getSettings(),
      killSwitch: true,
      transparentGatewayEnabled: true,
      explicitProxyEnabled: false,
      excludedDomains: [],
    });
    notifySettingsMock.mockReset().mockResolvedValue({ applied: true });
  });

  it("有効ガード値を変える PUT は proxy 適用成功後に保存する", async () => {
    const app = buildApp();
    notifySettingsMock.mockImplementation(async () => {
      expect(settingsStore.getSettings().killSwitch).toBe(true);
      return { applied: true };
    });

    const response = await app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });

    expect(response.statusCode).toBe(200);
    expect(settingsStore.getSettings().killSwitch).toBe(false);
    expect(notifySettingsMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("有効ガード値の proxy 適用失敗は503として永続値を保つ", async () => {
    const app = buildApp();
    notifySettingsMock.mockRejectedValue(new Error("proxy unavailable"));

    const response = await app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "kill_switch_not_applied" });
    expect(settingsStore.getSettings().killSwitch).toBe(true);
    await app.close();
  });

  it("proxy の503応答も有効ガード値を保存せず503にする", async () => {
    const app = buildApp();
    settingsStore.saveSettings({ ...settingsStore.getSettings(), explicitProxyEnabled: true });
    notifySettingsMock.mockResolvedValue({ applied: false });

    const response = await app.inject({ method: "PUT", url: "/v1/connection/config", payload: { transparentGatewayEnabled: false } });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "gateway_setting_not_applied" });
    expect(settingsStore.getSettings().transparentGatewayEnabled).toBe(true);
    await app.close();
  });

  it("キュー先頭で有効値変更になった PUT に5秒の待機期限を適用する", async () => {
    vi.useFakeTimers();
    const app = buildApp();
    settingsStore.saveSettings({ ...settingsStore.getSettings(), killSwitch: false, explicitProxyEnabled: true });
    let releaseBlocker!: () => void;
    const blocker = settingsNotificationQueue.run(async () => {
      settingsStore.saveSettings({ ...settingsStore.getSettings(), killSwitch: true });
      await new Promise<void>((resolve) => { releaseBlocker = resolve; });
    });

    try {
      await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
      const responsePromise = app.inject({
        method: "PUT",
        url: "/v1/connection/config",
        payload: { transparentGatewayEnabled: false },
      });
      await vi.advanceTimersByTimeAsync(5000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: "gateway_setting_not_applied" });
      expect(notifySettingsMock).not.toHaveBeenCalled();
      expect(settingsStore.getSettings().transparentGatewayEnabled).toBe(true);
      const nextPromise = app.inject({
        method: "PUT",
        url: "/v1/connection/config",
        payload: { killSwitch: false },
      });
      await vi.advanceTimersByTimeAsync(5000);
      const nextResponse = await nextPromise;
      expect(nextResponse.statusCode).toBe(503);
      expect(nextResponse.json()).toMatchObject({ error: "kill_switch_not_applied" });
      expect(settingsStore.getSettings().killSwitch).toBe(true);
    } finally {
      releaseBlocker();
      await blocker;
      await app.close();
      vi.useRealTimers();
    }
  });

  it("透過ゲートウェイ無効中の Kill Switch 変更は5秒超のキュー待ち後に保存する", async () => {
    vi.useFakeTimers();
    const app = buildApp();
    settingsStore.saveSettings({
      ...settingsStore.getSettings(),
      killSwitch: true,
      transparentGatewayEnabled: false,
      explicitProxyEnabled: true,
    });
    let releaseBlocker!: () => void;
    const blocker = settingsNotificationQueue.run(async () => {
      await new Promise<void>((resolve) => { releaseBlocker = resolve; });
    });
    try {
      await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
      const responsePromise = app.inject({
        method: "PUT",
        url: "/v1/connection/config",
        payload: { killSwitch: false },
      });
      await vi.advanceTimersByTimeAsync(6000);
      expect(settingsStore.getSettings().killSwitch).toBe(true);
      releaseBlocker();
      await blocker;
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(settingsStore.getSettings().killSwitch).toBe(false);
      expect(notifySettingsMock).toHaveBeenCalledOnce();
    } finally {
      if (releaseBlocker) releaseBlocker();
      await blocker;
      await app.close();
      vi.useRealTimers();
    }
  });

  it("後続 PUT の5秒判定は先行する未完了 PUT の投影値を使う", async () => {
    const app = buildApp();
    settingsStore.saveSettings({
      ...settingsStore.getSettings(),
      killSwitch: true,
      transparentGatewayEnabled: false,
      explicitProxyEnabled: true,
    });
    let releaseBlocker!: () => void;
    const blocker = settingsNotificationQueue.run(() => new Promise<void>((resolve) => { releaseBlocker = resolve; }));
    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
    const first = app.inject({ method: "PUT", url: "/v1/connection/config", payload: { transparentGatewayEnabled: true } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });
    await new Promise<void>((resolve) => setImmediate(resolve));

    releaseBlocker();
    await blocker;
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(notifySettingsMock).toHaveBeenCalledTimes(2);
    expect(settingsStore.getSettings()).toMatchObject({ killSwitch: false, transparentGatewayEnabled: true });
    await app.close();
  });

  it("先行 PUT が失敗したら投影を戻し、後続 PUT を実設定で再判定する", async () => {
    const app = buildApp();
    settingsStore.saveSettings({ ...settingsStore.getSettings(), explicitProxyEnabled: true });
    let releaseBlocker!: () => void;
    const blocker = settingsNotificationQueue.run(() => new Promise<void>((resolve) => { releaseBlocker = resolve; }));
    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
    const first = app.inject({ method: "PUT", url: "/v1/connection/config", payload: { transparentGatewayEnabled: false } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    notifySettingsMock.mockRejectedValue(new Error("proxy unavailable"));

    releaseBlocker();
    await blocker;
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.statusCode).toBe(503);
    expect(secondResponse.statusCode).toBe(503);
    expect(secondResponse.json()).toMatchObject({ error: "kill_switch_not_applied" });
    expect(settingsStore.getSettings()).toMatchObject({ killSwitch: true, transparentGatewayEnabled: true });
    expect(notifySettingsMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("先行ガード PUT 失敗で有効変更になる後続 PUT も5秒待機期限を持つ", async () => {
    vi.useFakeTimers();
    const app = buildApp();
    settingsStore.saveSettings({ ...settingsStore.getSettings(), explicitProxyEnabled: true });
    let rejectFirstNotification!: (error: Error) => void;
    notifySettingsMock.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFirstNotification = reject;
    }));
    const firstPromise = app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });

    try {
      await vi.waitFor(() => expect(rejectFirstNotification).toBeTypeOf("function"));
      const secondPromise = app.inject({
        method: "PUT",
        url: "/v1/connection/config",
        payload: { transparentGatewayEnabled: false },
      });
      await vi.advanceTimersByTimeAsync(5001);
      rejectFirstNotification(new Error("proxy unavailable"));
      const [firstResponse, secondResponse] = await Promise.all([firstPromise, secondPromise]);

      expect(firstResponse.statusCode).toBe(503);
      expect(secondResponse.statusCode).toBe(503);
      expect(secondResponse.json()).toMatchObject({ error: "gateway_setting_not_applied" });
      expect(settingsStore.getSettings()).toMatchObject({ killSwitch: true, transparentGatewayEnabled: true });
      expect(notifySettingsMock).toHaveBeenCalledOnce();
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("有効値変更とエラー分類を先行 PUT 後の設定で決める", async () => {
    const app = buildApp();
    settingsStore.saveSettings({
      ...settingsStore.getSettings(),
      killSwitch: false,
      transparentGatewayEnabled: true,
      explicitProxyEnabled: true,
    });
    let updatePriorSettings!: () => void;
    let releaseBlocker!: () => void;
    const blocker = settingsNotificationQueue.run(async () => {
      await new Promise<void>((resolve) => { updatePriorSettings = resolve; });
      settingsStore.saveSettings({ ...settingsStore.getSettings(), killSwitch: true });
      await new Promise<void>((resolve) => { releaseBlocker = resolve; });
    });
    await vi.waitFor(() => expect(updatePriorSettings).toBeTypeOf("function"));
    const responsePromise = app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });

    await new Promise<void>((resolve) => setImmediate(resolve));
    updatePriorSettings();
    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
    notifySettingsMock.mockRejectedValue(new Error("proxy unavailable"));
    releaseBlocker();
    await blocker;
    const response = await responsePromise;

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "kill_switch_not_applied" });
    expect(settingsStore.getSettings().killSwitch).toBe(true);
    await app.close();
  });

  it("先行 PUT 後に無効になるパッチもキュー内の最新値で再検証して400にする", async () => {
    const app = buildApp();
    let releaseBlocker!: () => void;
    const blocker = settingsNotificationQueue.run(async () => {
      settingsStore.saveSettings({
        ...settingsStore.getSettings(),
        dnsFailureMode: "fallback",
        dnsFallbackServers: ["1.1.1.1"],
      });
      await new Promise<void>((resolve) => { releaseBlocker = resolve; });
    });

    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
    const responsePromise = app.inject({
      method: "PUT",
      url: "/v1/connection/config",
      payload: { dnsFallbackServers: [] },
    });
    releaseBlocker();
    await blocker;
    const response = await responsePromise;

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_input" });
    expect(settingsStore.getSettings().dnsFallbackServers).toEqual(["1.1.1.1"]);
    expect(notifySettingsMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("透明ゲートウェイの変更では有効値に応じて通知を先行し保存する", async () => {
    const app = buildApp();
    settingsStore.saveSettings({ ...settingsStore.getSettings(), explicitProxyEnabled: true });
    notifySettingsMock.mockImplementation(async (settings: { transparentGatewayEnabled: boolean }) => {
      expect(settings.transparentGatewayEnabled).toBe(false);
      expect(settingsStore.getSettings().transparentGatewayEnabled).toBe(true);
      return { applied: true };
    });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/connection/config",
      payload: { transparentGatewayEnabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(settingsStore.getSettings().transparentGatewayEnabled).toBe(false);
    await app.close();
  });

  it.each([
    ["timeout", new ProxyTimeoutError("proxy timeout")],
    ["unreachable", new ProxyUnavailableError("proxy unavailable")],
  ] as const)("%s 通知失敗時に保存しない", async (_failure, error) => {
    const app = buildApp();
    notifySettingsMock.mockRejectedValue(error);

    const response = await app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });

    expect(response.statusCode).toBe(503);
    expect(settingsStore.getSettings().killSwitch).toBe(true);
    await app.close();
  });

  it("有効ガード値を変えない PUT は先に保存し、通知失敗でも成功する", async () => {
    const app = buildApp();
    notifySettingsMock.mockImplementation(async () => {
      expect(settingsStore.getSettings().excludedDomains).toEqual(["example.com"]);
      throw new Error("proxy unavailable");
    });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/connection/config",
      payload: { excludedDomains: ["example.com"] },
    });

    expect(response.statusCode).toBe(200);
    expect(settingsStore.getSettings().excludedDomains).toEqual(["example.com"]);
    await app.close();
  });

  it("通知成功後の保存失敗は500を返し、proxy へ適用済みでも成功扱いしない", async () => {
    const app = buildApp();
    const saveSpy = vi.spyOn(settingsStore, "saveSettings").mockImplementation(() => {
      throw new Error("disk full");
    });

    const response = await app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "internal_error" });
    expect(settingsStore.getSettings().killSwitch).toBe(true);
    expect(notifySettingsMock).toHaveBeenCalledOnce();
    saveSpy.mockRestore();
    await app.close();
  });

  it("起動通知と PUT を同じキューで直列化し、最後に新しい永続値を proxy へ届ける", async () => {
    const app = buildApp();
    let releaseNotification!: () => void;
    notifySettingsMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseNotification = resolve; });
      return { applied: true };
    });
    const startup = notifyStartupSettings(() => {});

    await vi.waitFor(() => expect(releaseNotification).toBeTypeOf("function"));
    const put = app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });
    releaseNotification();
    await startup;
    const response = await put;

    expect(response.statusCode).toBe(200);
    expect(notifySettingsMock).toHaveBeenCalledTimes(2);
    expect(notifySettingsMock.mock.calls.map(([settings]) => settings.killSwitch)).toEqual([true, false]);
    expect(settingsStore.getSettings().killSwitch).toBe(false);
    await app.close();
  });

  it("保存失敗後の周期再通知で proxy の最終値を永続値へ戻す", async () => {
    const app = buildApp();
    const appliedValues: boolean[] = [];
    notifySettingsMock.mockImplementation(async (settings: { killSwitch: boolean }) => {
      appliedValues.push(settings.killSwitch);
      return { applied: true };
    });
    const saveSpy = vi.spyOn(settingsStore, "saveSettings").mockImplementation(() => {
      throw new Error("disk full");
    });

    const response = await app.inject({ method: "PUT", url: "/v1/connection/config", payload: { killSwitch: false } });
    saveSpy.mockRestore();
    await notifyCurrentSettings();

    expect(response.statusCode).toBe(500);
    expect(settingsStore.getSettings().killSwitch).toBe(true);
    expect(appliedValues).toEqual([false, true]);
    await app.close();
  });

  it("周期再通知がキュー待機後に永続値を読み直す", async () => {
    let releaseBlocker!: () => void;
    const blocker = settingsNotificationQueue.run(async () => {
      await new Promise<void>((resolve) => { releaseBlocker = resolve; });
    });
    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
    const resync = notifyCurrentSettings();
    settingsStore.saveSettings({ ...settingsStore.getSettings(), excludedDomains: ["latest.example"] });
    releaseBlocker();
    await Promise.all([blocker, resync]);

    expect(notifySettingsMock).toHaveBeenCalledWith(expect.objectContaining({ excludedDomains: ["latest.example"] }));
  });
});
