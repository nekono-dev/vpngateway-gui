// 責務: 画面の表示と操作の試験（stack 群・ui）。要件 3.6・4.2・4.3・12.1・12.2・12.4。
// 接続先のお気に入り、接続ログ、設定ダイアログの全タブと動作検証、VPN のログアウト、API のエラー（502）の通知を、
// 画面に表示された結果で確かめる。直列に実行する（VPN のログイン状態と、ランナーの停止を、前の試験から引き継ぐ）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "../../fixtures/web";
import type { Page } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { apiClient, runnerContainer } from "../../fixtures/stack";
import { connectVpn, disconnectVpn, ensureAdminLogin, loginVpn, MOCK_PASSWORD, MOCK_USER } from "../../fixtures/gateway";
import { loginDashboard, openSettings } from "../../fixtures/ui";

const run = promisify(execFile);

/** 目的: 実ランナーが記録した接続・切断の実行引数を取得する（status の監視は除く）。 */
async function mutatingCommands(provider: "protonvpn" | "adguardvpn", actions: readonly string[] = ["connect", "disconnect"]): Promise<string[][]> {
  const { stdout } = await run("sudo", ["docker", "logs", runnerContainer(provider)]);
  return stdout.split("\n").flatMap((line) => {
    try {
      const event = JSON.parse(line) as { event?: string; argv?: string[] };
      return event.event === "exec_completed" && actions.includes(event.argv?.[0] ?? "") ? [event.argv!] : [];
    } catch { return []; }
  });
}

/** 目的: 戻る領域を、実ポインタで右へスワイプする。 */
async function swipeBack(page: Page): Promise<void> {
  const box = await page.locator(".location-back-bar").boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("戻る領域が無い");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("radiogroup", { name: "国", exact: true })).toBeVisible();
}

/** 目的: 提供元の初期取得による一覧の再マウントが終わってから操作する。 */
async function expectProviderReady(page: Page, provider: "protonvpn" | "adguardvpn"): Promise<void> {
  await expect(page.getByRole("combobox", { name: "VPNベンダー", exact: true })).toHaveValue(provider);
}

/** 目的: 設定ダイアログの全タブ（表示中のもの）を、順に開いて確かめる。 */
async function expectEveryTab(dialog: Locator): Promise<void> {
  for (const name of ["通信制御", "ゲートウェイ", "上位DNSリゾルバ", "動作検証", "メンテナンス"]) {
    const tab = dialog.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab, `${name} タブが選ばれる`).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tabpanel"), `${name} の内容が出る`).toBeVisible();
  }
}

test.describe.serial("画面の表示と操作（ui）", () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });
  const client = apiClient();

  test.beforeAll(async () => {
    test.setTimeout(3 * 60 * 1000);
    await ensureAdminLogin(client);
    await loginVpn(client);
  });

  test.afterAll(async () => {
    // 後始末: ランナーを起動状態に戻す
    await run("sudo", ["docker", "start", runnerContainer("protonvpn")]).catch(() => undefined);
  });

  // 未処理の JavaScript の例外は、そのシナリオを失敗にする（watchedPage の監視）。失敗すること自体が期待の結果
  test.fail("12.3: 未処理の JavaScript の例外があると、そのシナリオは失敗になる", async ({ watchedPage: page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("意図的な例外（12.3 の確認）");
      }, 0);
    });
    await page.waitForTimeout(500);
  });

  test("4.2・4.3・12.2: お気に入りを登録・解除すると、一覧の表示が変わる", async ({ watchedPage: page }) => {
    await loginDashboard(page);
    // 階層の画面: 国（Japan）を開き、「最速サーバ」の都市の行で ☆ を押す
    const openJapanCities = async () => {
      await page.locator("label.location-row", { hasText: "Japan" }).first().click();
      await page.getByRole("tab", { name: "最速サーバ" }).click();
    };
    await openJapanCities();
    const add = page.getByRole("button", { name: /をお気に入りに追加$/ }).first();
    await expect(add, "お気に入りに追加のボタンが無い").toBeVisible();
    const label = (await add.getAttribute("aria-label")) ?? "";
    const target = label.replace(/をお気に入りに追加$/, "");

    await add.click();
    const remove = page.getByRole("button", { name: `${target}のお気に入りを解除` });
    await expect(remove, "登録後に解除の表示になる").toBeVisible();

    // 再読み込みの後も、登録が保たれている（API の状態を画面が表示する）。国の一覧から開き直す
    await page.reload();
    await openJapanCities();
    await expect(page.getByRole("button", { name: `${target}のお気に入りを解除` })).toBeVisible();

    await page.getByRole("button", { name: `${target}のお気に入りを解除` }).click();
    await expect(page.getByRole("button", { name: `${target}をお気に入りに追加` })).toBeVisible();
  });

  test("location-city-selection 7.2: 国・都市・サーバを移動し、戻る・スワイプ・タブ保持・再計測を行える", async ({ watchedPage: page }) => {
    await loginDashboard(page);
    await client.put("/v1/providers/active", { providerId: "protonvpn" });
    const tabSaved = await client.put("/v1/connection/city-tab", { tab: "select" });
    expect(tabSaved.ok, "サーバ選択タブの設定に成功する").toBe(true);
    const cityTabLoaded = page.waitForResponse((response) => response.url().includes("/v1/connection/city-tab"));
    await page.reload();
    await cityTabLoaded;
    await expectProviderReady(page, "protonvpn");

    const openJapan = async () => {
      await page.locator("label.location-row", { hasText: "Japan" }).first().click();
      await expect(page.getByRole("tab", { name: "最速サーバ" })).toBeVisible();
    };
    await openJapan();

    const selectServers = page.getByRole("tab", { name: "サーバを選択" });
    await expect(selectServers).toHaveAttribute("aria-selected", "true");
    await page.locator("label.location-row", { hasText: "Tokyo" }).first().click();
    await expect(page.getByRole("list", { name: "サーバ" })).toBeVisible();
    await expect(page.getByRole("button", { name: "‹ Tokyo" })).toBeVisible();

    // 戻るボタンからのスワイプでも、一度の操作で戻るのは一階層だけ。
    const backButtonBox = await page.getByRole("button", { name: "‹ Tokyo", exact: true }).boundingBox();
    expect(backButtonBox, "サーバ一覧の戻るボタンが表示される").not.toBeNull();
    if (!backButtonBox) throw new Error("サーバ一覧の戻るボタンが無い");
    const startX = backButtonBox.x + backButtonBox.width / 2;
    const startY = backButtonBox.y + backButtonBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole("radiogroup", { name: "都市", exact: true })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "国", exact: true })).toHaveCount(0);
    await expect(selectServers).toHaveAttribute("aria-selected", "true");
    await page.locator("label.location-row", { hasText: "Tokyo" }).first().click();
    await expect(page.getByRole("list", { name: "サーバ", exact: true })).toBeVisible();

    // サーバ一覧から戻ると都市の選択タブが保たれ、右スワイプで国一覧へ戻る。
    await page.getByRole("button", { name: "‹ Tokyo" }).click();
    await expect(page.getByRole("radiogroup", { name: "都市" })).toBeVisible();
    await expect(selectServers).toHaveAttribute("aria-selected", "true");
    const backBar = page.locator(".location-back-bar");
    const box = await backBar.boundingBox();
    expect(box, "階層の戻る領域が表示される").not.toBeNull();
    if (box) {
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + 40, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, y, { steps: 4 });
      await page.mouse.up();
    }
    await expect(page.getByRole("radio", { name: /Japan/ })).toBeVisible();

    // 国を開き直しても都市タブを保持し、都市の取得し直しを要求できる。
    await openJapan();
    await expect(page.getByRole("tab", { name: "サーバを選択" })).toHaveAttribute("aria-selected", "true");
    const refresh = page.waitForResponse((response) => response.url().endsWith("/v1/connection/locations/refresh"));
    await page.getByRole("button", { name: "再計測" }).click();
    expect((await refresh).ok(), "都市の再計測 API が成功する").toBe(true);
  });

  for (const provider of ["protonvpn", "adguardvpn"] as const) {
    test(`location-city-selection 7.2: ${provider} の都市お気に入りから接続し、戻る・スワイプ・再計測を行える`, async ({ watchedPage: page }) => {
      expect((await client.put("/v1/providers/active", { providerId: provider })).ok).toBe(true);
      if (provider === "adguardvpn") expect((await client.post("/v1/session", null, 60_000)).ok).toBe(true);
      await client.delete("/v1/connection/locations/jp-tokyo/favorite");
      await loginDashboard(page);
      await expectProviderReady(page, provider);
      try {
        await page.locator("label.location-row", { hasText: "Japan" }).first().click();
        await page.getByRole("tab", { name: "最速サーバ", exact: true }).click();
        await expect(page.getByRole("tab", { name: "最速サーバ", exact: true })).toHaveAttribute("aria-selected", "true");
        if (provider === "adguardvpn") await expect(page.getByRole("tab", { name: "サーバを選択" })).toHaveCount(0);
        await page.getByRole("button", { name: "Tokyoをお気に入りに追加", exact: true }).click();
        await expect(page.getByRole("button", { name: "Tokyoのお気に入りを解除", exact: true })).toBeVisible();
        if (provider === "protonvpn") expect((await client.get("/v1/connection/locations/us/cities")).ok).toBe(true);
        const serversBefore = provider === "protonvpn" ? await client.get<{ name: string }[]>("/v1/connection/locations/jp-tokyo/servers") : undefined;
        if (serversBefore) expect(serversBefore.ok).toBe(true);
        const cityCommandsBefore = await mutatingCommands(provider, ["cities"]);
        const citiesReloaded = page.waitForResponse((response) => response.request().method() === "GET" && response.url().endsWith("/v1/connection/locations/jp/cities"));
        const refreshed = page.waitForResponse((response) => response.url().endsWith("/v1/connection/locations/refresh"));
        await page.getByRole("button", { name: "再計測", exact: true }).click();
        expect((await refreshed).ok()).toBe(true);
        expect((await citiesReloaded).ok()).toBe(true);
        if (provider === "protonvpn") {
          expect((await client.get("/v1/connection/locations/us/cities")).ok).toBe(true);
          await expect.poll(async () => (await mutatingCommands(provider, ["cities"])).slice(cityCommandsBefore.length)).toEqual([
            ["cities", "list", "--country", "JP"], ["cities", "list", "--country", "US"],
          ]);
          const servers = await client.get<{ name: string }[]>("/v1/connection/locations/jp-tokyo/servers");
          expect(servers.ok).toBe(true);
          expect(servers.ok && servers.body.map((server) => server.name)).toEqual(serversBefore?.ok ? serversBefore.body.map((server) => server.name) : undefined);
        }

        await page.getByRole("button", { name: "‹ 国一覧", exact: true }).click();
        await expect(page.getByRole("radiogroup", { name: "国", exact: true })).toBeVisible();
        await page.locator("label.location-row", { hasText: "Japan" }).first().click();
        await expect(page.getByRole("tab", { name: "最速サーバ", exact: true })).toHaveAttribute("aria-selected", "true");
        await swipeBack(page);
        await page.getByRole("tab", { name: "お気に入り", exact: true }).click();
        await page.getByRole("radiogroup", { name: "お気に入り", exact: true }).locator("label.location-row", { hasText: "Tokyo" }).click();
        const before = await mutatingCommands(provider);
        await page.getByRole("button", { name: "接続", exact: true }).click();
        await expect(page.locator(".connection-label")).toHaveText("接続中", { timeout: 60_000 });
        await expect.poll(async () => {
          const state = await client.get<{ locationId?: string }>("/v1/connection");
          return state.ok ? state.body.locationId : undefined;
        }).toBe("jp-tokyo");
        const commands = (await mutatingCommands(provider)).slice(before.length);
        expect(commands).toEqual([provider === "protonvpn" ? ["connect", "JP-TK#1"] : ["connect", "-l", "Tokyo", "-y"]]);
        await page.getByRole("button", { name: "切断", exact: true }).click();
        await expect(page.locator(".connection-label")).toHaveText("切断", { timeout: 60_000 });
      } finally {
        await disconnectVpn(client);
        await client.delete("/v1/connection/locations/jp-tokyo/favorite");
        await client.put("/v1/providers/active", { providerId: "protonvpn" });
      }
    });
  }

  test("location-city-selection 7.2: サーバのお気に入りから指定したサーバへ接続する", async ({ watchedPage: page }) => {
    await client.put("/v1/providers/active", { providerId: "protonvpn" });
    await client.delete("/v1/connection/locations/srv-jp-tk-2/favorite");
    await loginDashboard(page);
    await expectProviderReady(page, "protonvpn");
    try {
      await page.locator("label.location-row", { hasText: "Japan" }).first().click();
      await page.getByRole("tab", { name: "サーバを選択", exact: true }).click();
      await page.locator("label.location-row", { hasText: "Tokyo" }).first().click();
      await page.getByRole("button", { name: "JP-TK#2をお気に入りに追加", exact: true }).click();
      await expect(page.getByRole("button", { name: "JP-TK#2のお気に入りを解除", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "‹ Tokyo", exact: true }).click();
      await page.getByRole("button", { name: "‹ 国一覧", exact: true }).click();
      await page.getByRole("tab", { name: "お気に入り", exact: true }).click();
      await page.getByRole("radiogroup", { name: "お気に入り", exact: true }).locator("label.location-row", { hasText: "JP-TK#2" }).click();
      const before = await mutatingCommands("protonvpn");
      await page.getByRole("button", { name: "接続", exact: true }).click();
      await expect(page.locator(".connection-label")).toHaveText("接続中", { timeout: 60_000 });
      expect((await mutatingCommands("protonvpn")).slice(before.length)).toEqual([["connect", "JP-TK#2"]]);
    } finally {
      await disconnectVpn(client);
      await client.delete("/v1/connection/locations/srv-jp-tk-2/favorite");
    }
  });

  test("location-city-selection 7.2: AdGuard の一覧外お気に入りは切断後に国名へ接続し、無通知で削除する", async ({ watchedPage: page }) => {
    await client.put("/v1/providers/active", { providerId: "adguardvpn" });
    expect((await client.post("/v1/session", null, 60_000)).ok).toBe(true);
    const id = "srv-jp-zz-9";
    expect((await client.put(`/v1/connection/locations/${id}/favorite`, { id, kind: "server", country: "jp", countryName: "Japan", city: "Tokyo", serverName: "JP-ZZ#9" })).ok).toBe(true);
    await connectVpn(client);
    await loginDashboard(page);
    await expectProviderReady(page, "adguardvpn");
    try {
      await page.getByRole("tab", { name: "お気に入り", exact: true }).click();
      const missing = page.getByRole("radiogroup", { name: "お気に入り", exact: true }).locator("label.location-row", { hasText: "JP-ZZ#9" });
      await expect(missing).toBeVisible();
      await expectProviderReady(page, "adguardvpn");
      await missing.click();
      await expect(missing.getByRole("radio")).toBeChecked();
      // 一瞬だけ表示される通知も取り逃がさないよう、操作前から通知領域を監視する。
      await page.evaluate(() => {
        const region = document.querySelector(".toast-region");
        const notices: string[] = [];
        (window as unknown as { fallbackNotices: string[] }).fallbackNotices = notices;
        if (!region) throw new Error("通知領域が無い");
        new MutationObserver(() => { if (region.textContent?.trim()) notices.push(region.textContent); }).observe(region, { childList: true, subtree: true, characterData: true });
      });
      const before = await mutatingCommands("adguardvpn");
      const response = page.waitForResponse((item) => item.request().method() === "PUT" && /\/v1\/connection$/.test(item.url()));
      await page.getByRole("button", { name: "接続先を変更", exact: true }).click();
      expect((await response).ok()).toBe(true);
      await expect(missing).toHaveCount(0);
      await expect(page.locator(".connection-label")).toHaveText("接続中", { timeout: 60_000 });
      expect((await mutatingCommands("adguardvpn")).slice(before.length)).toEqual([["disconnect"], ["connect", "-l", "Japan", "-y"]]);
      const favorites = await client.get<{ id: string }[]>("/v1/connection/favorites");
      expect(favorites.ok, "削除後のお気に入り一覧が取得できる").toBe(true);
      expect(favorites.ok && favorites.body.some((item) => item.id === id)).toBe(false);
      expect(await page.evaluate(() => (window as unknown as { fallbackNotices: string[] }).fallbackNotices)).toEqual([]);
      await expect(page.locator(".toast-region [role=alert]")).toHaveCount(0);
    } finally {
      await disconnectVpn(client);
      await client.delete(`/v1/connection/locations/${id}/favorite`);
      await client.put("/v1/providers/active", { providerId: "protonvpn" });
    }
  });

  test("location-city-selection 7.2: 390px の実タッチ操作でサーバから都市、都市から国へ一階層ずつ戻る", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const touch = await context.newCDPSession(page);
    const swipeFromBackButton = async (label: string) => {
      const box = await page.getByRole("button", { name: label, exact: true }).boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("タッチ操作の起点となる戻るボタンが無い");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + step * 20, y }] });
        await page.waitForTimeout(20);
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    try {
      expect((await client.put("/v1/providers/active", { providerId: "protonvpn" })).ok).toBe(true);
      await loginDashboard(page);
      await expectProviderReady(page, "protonvpn");
      await page.locator("label.location-row", { hasText: "Japan" }).first().tap();
      await page.getByRole("tab", { name: "サーバを選択", exact: true }).tap();
      await page.locator("label.location-row", { hasText: "Tokyo" }).first().tap();
      await expect(page.getByRole("list", { name: "サーバ", exact: true })).toBeVisible();
      await swipeFromBackButton("‹ Tokyo");
      await expect(page.getByRole("radiogroup", { name: "都市", exact: true })).toBeVisible();
      await expect(page.getByRole("radiogroup", { name: "国", exact: true })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "サーバを選択", exact: true })).toHaveAttribute("aria-selected", "true");
      await test.info().attach("390px-proton-touch-city", { body: await page.screenshot(), contentType: "image/png" });
      await swipeFromBackButton("‹ 国一覧");
      await expect(page.getByRole("radiogroup", { name: "国", exact: true })).toBeVisible();

      expect((await client.put("/v1/providers/active", { providerId: "adguardvpn" })).ok).toBe(true);
      expect((await client.post("/v1/session", null, 60_000)).ok).toBe(true);
      await page.reload();
      await expectProviderReady(page, "adguardvpn");
      await page.locator("label.location-row", { hasText: "Japan" }).first().tap();
      await expect(page.getByRole("radiogroup", { name: "都市", exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: "サーバを選択", exact: true })).toHaveCount(0);
      await swipeFromBackButton("‹ 国一覧");
      await expect(page.getByRole("radiogroup", { name: "国", exact: true })).toBeVisible();
      await test.info().attach("390px-adguard-touch-countries", { body: await page.screenshot(), contentType: "image/png" });
      expect(errors, "モバイルの操作中に JavaScript エラーが無い").toEqual([]);
    } finally {
      await context.close();
      await client.put("/v1/providers/active", { providerId: "protonvpn" });
    }
  });

  test("location-city-selection 7.2: 開いたサーバ一覧の接続中バッジが接続・切断で更新される", async ({ watchedPage: page }) => {
    await client.put("/v1/providers/active", { providerId: "protonvpn" });
    await loginDashboard(page);
    await expectProviderReady(page, "protonvpn");
    try {
      await page.locator("label.location-row", { hasText: "Japan" }).first().click();
      await page.getByRole("tab", { name: "サーバを選択", exact: true }).click();
      await page.locator("label.location-row", { hasText: "Tokyo" }).first().click();
      const server = page.getByRole("list", { name: "サーバ", exact: true }).locator("li", { hasText: "JP-TK#2" });
      await server.locator("label.location-row").click();
      await page.getByRole("button", { name: "接続", exact: true }).click();
      await expect(server.getByText("接続中", { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("list", { name: "サーバ", exact: true }).getByText("接続中", { exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "切断", exact: true }).click();
      await expect(server.getByText("接続中", { exact: true })).toHaveCount(0, { timeout: 60_000 });
      await expect(page.getByRole("list", { name: "サーバ", exact: true })).toBeVisible();
    } finally {
      await disconnectVpn(client);
    }
  });

  test("12.1: 接続ログの画面が開き、一覧の見出しを表示する（3.4）", async ({ watchedPage: page }) => {
    await loginDashboard(page);
    await page.getByRole("button", { name: "接続ログ", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "接続ログ" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "接続ログ" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("12.1: 設定ダイアログの全タブを開き、動作検証を実行して結果を表示する", async ({ watchedPage: page }) => {
    await loginDashboard(page);
    const dialog = await openSettings(page);
    await expectEveryTab(dialog);

    // 動作検証タブで検証を実行し、完了の表示（もう一度実行）になる
    await dialog.getByRole("tab", { name: "動作検証", exact: true }).click();
    await dialog.getByRole("button", { name: "検証を実行" }).click();
    await expect(dialog.getByRole("button", { name: "もう一度実行" })).toBeVisible({ timeout: 3 * 60 * 1000 });
    await dialog.getByRole("button", { name: "キャンセル" }).click();
  });

  test("3.1・3.2・3.4: 接続すると接続中、切断すると切断と画面に出る。接続ログに両方の操作が並ぶ", async ({ watchedPage: page }) => {
    // 接続と切断は API で行い、その結果を画面（接続状態の表示と接続ログの一覧）で確かめる
    await loginDashboard(page);
    await connectVpn(client);
    await expect(page.locator(".connection-label"), "接続中の表示が出ない").toHaveText("接続中", { timeout: 60 * 1000 });

    await disconnectVpn(client);
    await expect(page.locator(".connection-label"), "切断の表示が出ない").toHaveText("切断", { timeout: 60 * 1000 });

    await page.getByRole("button", { name: "接続ログ", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "接続ログ" });
    await expect(dialog.getByRole("cell", { name: "接続", exact: true }), "接続の操作が一覧に無い").not.toHaveCount(0);
    await expect(dialog.getByRole("cell", { name: "切断", exact: true }), "切断の操作が一覧に無い").not.toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("3.6・12.1: VPN からログアウトすると、ログインの導線に戻る", async ({ watchedPage: page }) => {
    // ログアウトの確認（window.confirm）は承認する
    page.once("dialog", (dialog) => void dialog.accept());
    await loginDashboard(page);
    const session = page.locator(".session-action");
    await session.getByRole("button", { name: "ログアウト", exact: true }).click();
    await expect(session.getByRole("button", { name: "ログイン", exact: true })).toBeVisible();

    const state = await client.get<{ loggedIn?: boolean }>("/v1/session");
    expect(state.ok && state.body.loggedIn).toBe(false);
  });

  test("12.4: API が 502 を返すと、利用者に分かるエラーの通知を表示する", async ({ watchedPage: page, pageErrors }) => {
    // 502 の応答は、ブラウザがリソースの失敗として記録する（この試験の意図した結果）
    pageErrors.allow(/status of 502/);
    // 前提: VPN は未ログイン（3.6 の後）。ランナーを止めると、ログインの要求は 502 になる
    await run("sudo", ["docker", "stop", runnerContainer("protonvpn")]);
    try {
      await loginDashboard(page);
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
      await page.getByLabel("ユーザー名").fill(MOCK_USER);
      await page.getByLabel("パスワード", { exact: true }).fill(MOCK_PASSWORD);
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
      const toast = page.locator(".toast-region [role=alert]").first();
      await expect(toast, "502 の通知が出ない").toBeVisible();
    } finally {
      await run("sudo", ["docker", "start", runnerContainer("protonvpn")]);
    }
  });
});
