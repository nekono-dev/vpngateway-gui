// 責務: hosted Compose lifecycle と永続データの保持・明示削除を実スタックで検証する。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { composeBuildAndUp, composeConfig, composeDown, composeDownVolumes, composeRecreate, composeUp, HOSTED_COMPOSE_FRAGMENTS, runCompose } from "../../fixtures/compose.js";
import { ensureAdminLogin, loginVpn } from "../../fixtures/gateway.js";
import { apiClient, loadAdmin } from "../../fixtures/stack.js";

const run = promisify(execFile);
const DETACHED_FRAGMENTS = [
  "vendors/adguardvpn/compose.yml",
  "docker-compose.e2e-mock.yml",
  "e2e/hosted/vendors/adguardvpn/compose.yml",
] as const;
const client = apiClient();
const favorite = { id: "jp-tokyo", kind: "city", country: "jp", countryName: "Japan", city: "Tokyo" };
type Config = { killSwitch: boolean; dnsRelayEnabled: boolean; dnsUpstreamUrl: string };

async function docker(args: readonly string[]): Promise<string> {
  const { stdout } = await run("docker", [...args], { encoding: "utf8" });
  return stdout.trim();
}

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 180_000;
  let last = "API 応答待ち";
  while (Date.now() < deadline) {
    const state = await client.get<{ configured: boolean }>("/v1/operator");
    if (state.ok) return;
    last = state.kind === "http" ? `${state.status} ${state.error}` : state.message;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Compose 起動後に API が応答しない: ${last}`);
}

async function loginAdmin(): Promise<void> {
  const login = await client.post("/v1/operator/session", await loadAdmin());
  expect(login.ok, "管理者の再ログインに失敗").toBe(true);
}

async function assertPersistedData(): Promise<void> {
  await waitForApi();
  await loginAdmin();

  const operator = await client.get<{ configured: boolean }>("/v1/operator");
  expect(operator.ok && operator.body.configured, "管理者アカウントが保持されていない").toBe(true);

  const config = await client.get<Config>("/v1/connection/config");
  expect(config.ok, "接続設定を読み取れない").toBe(true);
  expect(config.ok && config.body.killSwitch, "変更した設定が保持されていない").toBe(false);

  const favorites = await client.get<{ id: string }[]>("/v1/connection/favorites");
  expect(favorites.ok && favorites.body.some((entry) => entry.id === favorite.id), "お気に入りが保持されていない").toBe(true);

  const audit = await docker(["exec", "vpngwgui-api-1", "cat", "/var/lib/vpngwgui/audit.log"]);
  expect(audit, "監査イベントが保持されていない").toContain('"action":"switch-provider"');

  const vendorState = JSON.parse(await docker(["exec", "vpngwgui-runner-protonvpn-1", "cat", "/var/lib/mockvpn/protonvpn.json"])) as { loggedIn?: boolean };
  expect(vendorState.loggedIn, "ベンダーのログイン状態が保持されていない").toBe(true);
}

async function assertEmptySetup(): Promise<void> {
  await waitForApi();
  const operator = await client.get<{ configured: boolean }>("/v1/operator");
  expect(operator.ok && operator.body.configured, "down -v 後も管理者データが残っている").toBe(false);
}

test.describe("hosted lifecycle と永続データ", () => {
  test.describe.configure({ timeout: 30 * 60 * 1000 });

  test.afterAll(async () => {
    // 明示削除を含む全ケースの後に、後続 project 用の clean slate を保証する。
    composeDownVolumes(HOSTED_COMPOSE_FRAGMENTS);
  });

  test("通常操作ではデータを保持し、down -v の後だけ初期状態へ戻る", async ({ page }) => {
    await test.step("前提データを作成する", async () => {
      await ensureAdminLogin(client);
      const current = await client.get<Config>("/v1/connection/config");
      expect(current.ok, "初期設定を取得できない").toBe(true);
      if (!current.ok) return;
      const changed = await client.put("/v1/connection/config", { ...current.body, killSwitch: false });
      expect(changed.ok, "設定を変更できない").toBe(true);
      const added = await client.put(`/v1/connection/locations/${favorite.id}/favorite`, favorite);
      expect(added.ok, "お気に入りを登録できない").toBe(true);
      await loginVpn(client);
      const switched = await client.put("/v1/providers/active", { providerId: "adguardvpn" });
      expect(switched.ok, "監査イベント用のベンダー切替に失敗").toBe(true);
      const restored = await client.put("/v1/providers/active", { providerId: "protonvpn" });
      expect(restored.ok, "検証対象のベンダーへ戻せない").toBe(true);
      const adguardLogin = await client.put("/v1/providers/active", { providerId: "adguardvpn" });
      expect(adguardLogin.ok, "別ベンダーのログイン準備に失敗").toBe(true);
      const adguardSession = await client.post("/v1/session", null, 60_000);
      expect(adguardSession.ok, "別ベンダーの状態を保存できない").toBe(true);
      const restoreProton = await client.put("/v1/providers/active", { providerId: "protonvpn" });
      expect(restoreProton.ok, "検証対象のベンダーへ戻せない").toBe(true);
      await assertPersistedData();
    });

    await test.step("資材更新相当の build と up 後も保持する", async () => {
      composeBuildAndUp(HOSTED_COMPOSE_FRAGMENTS);
      await assertPersistedData();
    });

    await test.step("force-recreate 後も保持する", async () => {
      composeRecreate(HOSTED_COMPOSE_FRAGMENTS);
      await assertPersistedData();
    });

    await test.step("通常 down と up 後も保持する", async () => {
      composeDown(HOSTED_COMPOSE_FRAGMENTS);
      composeUp(HOSTED_COMPOSE_FRAGMENTS);
      await assertPersistedData();
    });

    await test.step("通常 down 後に fragment を外して orphan を識別し、回復する", async () => {
      const allVolumeNames = Object.values(composeConfig(HOSTED_COMPOSE_FRAGMENTS).volumes)
        .map(({ name }) => name);
      const protonVolumeNames = ["proton-config", "proton-keyrings", "proton-cache"]
        .map((key) => composeConfig(HOSTED_COMPOSE_FRAGMENTS).volumes[key]?.name)
        .filter((name): name is string => name !== undefined);

      // 全 fragment を指定した通常 down を先に行い、停止・再起動でも保存状態が残ることを確かめる。
      composeDown(HOSTED_COMPOSE_FRAGMENTS);
      composeUp(HOSTED_COMPOSE_FRAGMENTS);
      await assertPersistedData();

      const adguardState = await docker(["exec", "vpngwgui-runner-adguardvpn-1", "cat", "/var/lib/mockvpn/adguardvpn.json"]);
      const savedAdguardState = JSON.parse(adguardState) as Record<string, unknown>;
      expect(savedAdguardState).toMatchObject({ loggedIn: true });

      // AdGuard fragment を残して Proton fragment だけを構成から外し、up 後の Proton を orphan として識別する。
      runCompose(["up", "-d"], DETACHED_FRAGMENTS);
      const detachedConfig = composeConfig(DETACHED_FRAGMENTS);
      expect(detachedConfig.services["runner-protonvpn"]).toBeUndefined();
      expect(detachedConfig.services["runner-adguardvpn"]).toBeDefined();
      const composeContainers = runCompose(["ps", "-a"], DETACHED_FRAGMENTS);
      expect(composeContainers).toContain("runner-adguardvpn");
      const names = (await docker(["ps", "-a", "--filter", "label=com.docker.compose.project=vpngwgui", "--format", "{{.Names}}"])).split("\n");
      expect(names).toContain("vpngwgui-runner-protonvpn-1");
      expect(names).toContain("vpngwgui-runner-adguardvpn-1");
      const runnerContainers = names.filter((name) => name.startsWith("vpngwgui-runner-"));
      expect(runnerContainers).toHaveLength(2);
      const labels = await Promise.all(runnerContainers.map(async (name) => {
        const result = await docker(["inspect", "--format", "{{json .Config.Labels}}", name]);
        return { name, labels: JSON.parse(result) as Record<string, string> };
      }));
      expect(labels).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: "vpngwgui-runner-protonvpn-1",
          labels: expect.objectContaining({
            "com.docker.compose.project": "vpngwgui",
            "com.docker.compose.service": "runner-protonvpn",
          }),
        }),
        expect.objectContaining({
          name: "vpngwgui-runner-adguardvpn-1",
          labels: expect.objectContaining({
            "com.docker.compose.project": "vpngwgui",
            "com.docker.compose.service": "runner-adguardvpn",
          }),
        }),
      ]));
      const orphanServices = labels
        .map(({ labels: containerLabels }) => containerLabels["com.docker.compose.service"])
        .filter((service): service is string => service !== undefined && detachedConfig.services[service] === undefined);
      expect(orphanServices).toEqual(["runner-protonvpn"]);
      const adguardInspect = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", "vpngwgui-runner-adguardvpn-1"])) as { Status: string };
      expect(adguardInspect.Status).toBe("running");
      const existingVolumes = (await docker(["volume", "ls", "--filter", "label=com.docker.compose.project=vpngwgui", "--format", "{{.Name}}"])).split("\n");
      for (const name of allVolumeNames) expect(existingVolumes).toContain(name);
      await assertPersistedData();

      // 固定 project の orphan が実在する場合だけ --remove-orphans を使用する。
      runCompose(["up", "-d", "--remove-orphans"], DETACHED_FRAGMENTS);
      const afterRecovery = (await docker(["ps", "-a", "--filter", "label=com.docker.compose.project=vpngwgui", "--format", "{{.Names}}"])).split("\n");
      expect(afterRecovery).not.toContain("vpngwgui-runner-protonvpn-1");
      expect(afterRecovery).toContain("vpngwgui-runner-adguardvpn-1");
      const adguardAfterRecovery = JSON.parse(await docker(["exec", "vpngwgui-runner-adguardvpn-1", "cat", "/var/lib/mockvpn/adguardvpn.json"])) as { loggedIn?: boolean };
      expect(adguardAfterRecovery).toEqual(savedAdguardState);
      const adguardStatus = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", "vpngwgui-runner-adguardvpn-1"])) as { Status: string };
      expect(adguardStatus.Status).toBe("running");
      await waitForApi();
      const remainingVolumes = (await docker(["volume", "ls", "--filter", "label=com.docker.compose.project=vpngwgui", "--format", "{{.Name}}"])).split("\n");
      for (const name of allVolumeNames) expect(remainingVolumes).toContain(name);
      await loginAdmin();
      const config = await client.get<Config>("/v1/connection/config");
      expect(config.ok && config.body.killSwitch).toBe(false);
      const favorites = await client.get<{ id: string }[]>("/v1/connection/favorites");
      expect(favorites.ok && favorites.body.some((entry) => entry.id === favorite.id)).toBe(true);
      const audit = await docker(["exec", "vpngwgui-api-1", "cat", "/var/lib/vpngwgui/audit.log"]);
      expect(audit).toContain('"action":"switch-provider"');

      // vendor fragment を戻すと同じ named volume 上の runner 状態へ再接続する。
      expect(composeConfig(HOSTED_COMPOSE_FRAGMENTS).volumes["proton-config"]?.name).toBe(protonVolumeNames[0]);
      composeUp(HOSTED_COMPOSE_FRAGMENTS);
      await assertPersistedData();
    });

    await test.step("down -v が固定 project の named volume を削除する", async () => {
      composeDownVolumes(HOSTED_COMPOSE_FRAGMENTS);
      const volumes = await docker(["volume", "ls", "--filter", "label=com.docker.compose.project=vpngwgui", "--format", "{{.Name}}"]);
      expect(volumes).toBe("");
    });

    await test.step("削除後の up は初期設定画面から始まる", async () => {
      composeUp(HOSTED_COMPOSE_FRAGMENTS);
      await assertEmptySetup();
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "初期設定" })).toBeVisible();
    });
  });
});
