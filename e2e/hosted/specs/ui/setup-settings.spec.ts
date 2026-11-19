// 責務: 設定の保存と再表示の画面試験（stack 群・ui）。ファイル名は setup-login の後に実行されるよう、setup- で始める（管理者は setup-login が作る）。要件 13.1・13.2・13.3・12.2。
// 設定ダイアログで変更して保存し、開き直して保存された値が表示されること、不正な値が 400 で拒否され
// 保存済みの値が変わらず通知が出ることを確かめる。直列に実行する。

import { test, expect } from "../../fixtures/web";
import { apiClient, loadAdmin } from "../../fixtures/stack";
import { loginDashboard as login, openSettings } from "../../fixtures/ui";

type Config = { killSwitch: boolean; dnsRelayEnabled: boolean; dnsUpstreamUrl: string };

test.describe.serial("設定の保存と再表示（ui）", () => {
  const client = apiClient();

  test.beforeAll(async () => {
    // 試験の開始時の状態をそろえる（Kill Switch は有効、DNS 中継は無効）
    const admin = await loadAdmin();
    const login = await client.post("/v1/operator/session", admin);
    expect(login.ok, "管理者のログインに失敗").toBe(true);
    const put = await client.put("/v1/connection/config", { killSwitch: true, dnsRelayEnabled: false, dnsUpstreamUrl: "" });
    expect(put.ok, "設定の初期化に失敗").toBe(true);
  });

  test("13.1: 設定を変えて保存すると、保存された値が返る", async ({ watchedPage: page }) => {
    await login(page);
    const dialog = await openSettings(page);
    // 通信制御タブの Kill Switch を無効にして保存する
    await dialog.getByRole("tab", { name: "通信制御" }).click();
    await dialog.getByLabel("Kill Switch").uncheck();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();

    const saved = await client.get<Config>("/v1/connection/config");
    expect(saved.ok && saved.body.killSwitch).toBe(false);
  });

  test("13.2: 開き直すと、保存された値が表示される", async ({ watchedPage: page }) => {
    await login(page);
    const dialog = await openSettings(page);
    await dialog.getByRole("tab", { name: "通信制御" }).click();
    await expect(dialog.getByLabel("Kill Switch")).not.toBeChecked();
  });

  test("13.3・12.2: 不正な値は 400 で拒否され、保存済みの値は変わらず、通知が出る", async ({ watchedPage: page, pageErrors }) => {
    // 不正な値の 400 は、この試験の意図した結果（ブラウザがリソースの失敗として記録する）
  pageErrors.allow(/status of 400 \(Bad Request\) \(http:\/\/127\.0\.0\.1:18080\/api\/v1\/connection\/config\)/);
    await login(page);
    const dialog = await openSettings(page);

    // DNS 中継を有効にし、自宅 DNS サーバの URL に https 以外（http）を入れる。画面は形式を止めないため、保存は API が拒否する
    await dialog.getByRole("tab", { name: "上位DNSリゾルバ" }).click();
    await dialog.getByLabel("DNS中継を有効にする").check();
    await dialog.getByLabel("自宅DNSサーバ（DoHのURL）").fill("http://192.168.50.254/dns-query");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();

    // 通知が出て、ダイアログは閉じない
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog).toBeVisible();

    // 保存済みの値は変わっていない（API の状態で確かめる）
    const state = await client.get<Config>("/v1/connection/config");
    expect(state.ok && state.body.dnsRelayEnabled).toBe(false);
    expect(state.ok && state.body.dnsUpstreamUrl).toBe("");
    expect(state.ok && state.body.killSwitch).toBe(false);

    // 後始末: 画面の変更を破棄して閉じる
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    // Kill Switch は次の試験（13.2）が確かめるため、元の値（無効）のまま残す
  });

  test("2.8・8.2: 明示的プロキシのみの設定で Kill Switch の保証範囲を表示する", async ({ watchedPage: page }) => {
    const admin = await loadAdmin();
    const current = await client.get<Record<string, unknown>>("/v1/connection/config");
    expect(current.ok, "現在の接続設定を取得できない").toBe(true);
    if (!current.ok) return;

    const session = await client.post("/v1/operator/session", admin);
    expect(session.ok, "管理者のログインに失敗").toBe(true);
    if (!session.ok) return;

    try {
      const configured = await client.put("/v1/connection/config", {
        ...current.body,
        transparentGatewayEnabled: false,
        explicitProxyEnabled: true,
        explicitProxyAllowedCidrs: ["192.168.50.0/24"],
      });
      expect(configured.ok, "明示的プロキシのみの設定にできない").toBe(true);

      await login(page);
      const dialog = await openSettings(page);
      await dialog.getByRole("tab", { name: "通信制御" }).click();
      await expect(dialog.getByText("Kill Switch は透過ゲートウェイモードにのみ適用されます。明示的プロキシのみでは Gateway 停止時の遮断を保証しません。")).toBeVisible();
    } finally {
      const restored = await client.put("/v1/connection/config", current.body);
      expect(restored.ok, `接続設定の復元に失敗: ${restored.ok ? "成功" : restored.kind === "http" ? `${restored.status} ${restored.error} ${restored.message}` : restored.message}`).toBe(true);
      const logout = await client.delete("/v1/operator/session");
      expect(logout.ok, `管理者セッションの破棄に失敗: ${logout.ok ? "成功" : logout.kind === "http" ? `${logout.status} ${logout.error} ${logout.message}` : logout.message}`).toBe(true);
    }
  });
});
