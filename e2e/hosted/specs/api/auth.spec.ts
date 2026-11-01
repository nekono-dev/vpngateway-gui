// 責務: 認証の制限・API の認証・管理者の変更の試験（stack 群・api）。要件 2.5・2.6・2.7・2.9・2.10。
// ui 群が作った管理者で行う（資格情報は作業場所から読む）。直列に実行する（制限の窓の時間に依存するため）。

import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { apiClient, loadAdmin, saveAdmin, API_BASE_URL, API_CA_PATH } from "../../fixtures/stack";
import { createApiClient, type ApiResult } from "../../../common/api-client";
import { makeAdminCredentials } from "../../fixtures/admin";

const LOGIN = "/v1/operator/session";

/** 目的: 応答の HTTP の状態コードを返す（通信の失敗は 0）。 */
function statusOf<T>(res: ApiResult<T>): number {
  if (res.ok) return res.status;
  return res.kind === "http" ? res.status : 0;
}
/** ログイン試行の窓（API の既定: 60 秒。要件 2.5・2.6）。 */
const WINDOW_MS = 60_000;

test.describe.serial("認証の制限・API の認証・管理者の変更（stack・api）", () => {
  // 制限の窓（60 秒）を待つ試験があるため、群の上限を延ばす
  test.describe.configure({ timeout: 5 * 60 * 1000 });
  test("2.5: 60 秒以内に 5 回失敗すると、429 で拒否する", async () => {
    const client = apiClient();
    const admin = await loadAdmin();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await client.post(LOGIN, { username: admin.username, password: `wrong-${i}` });
      statuses.push(statusOf(res));
      if (statusOf(res) === 429) break;
    }
    expect(statuses).toContain(429);
    // 429 までに、失敗（401）が 4 件以上あること（ui 群の失敗が窓に入っている場合は少なくなる）
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(4);
  });

  test("2.6: 失敗の記録が窓の外に出ると、再び受け付ける", async () => {
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 5_000));
    const admin = await loadAdmin();
    const res = await apiClient().post(LOGIN, { username: admin.username, password: admin.password });
    expect(res.ok, "窓の外に出た後も、正しい資格情報が拒否される").toBe(true);
  });

  test("2.7: 未ログインで保護された API（再起動依頼）を呼ぶと 401 を返し、操作を行わない", async () => {
    const before = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
    // 新しいクライアント（Cookie を持たない）で呼ぶ
    const anonymous = createApiClient({ baseUrl: API_BASE_URL, caPath: API_CA_PATH });
    const res = await anonymous.post("/v1/gateway/reboot");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(statusOf(res)).toBe(401);
    // 再起動が行われていないことを、起動からの経過時間が減っていないことで確かめる
    const after = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test("2.10: 現在のパスワードが誤りなら 401 を返し、管理者の変更は行われない", async () => {
    const admin = await loadAdmin();
    const client = apiClient();
    const login = await client.post(LOGIN, { username: admin.username, password: admin.password });
    expect(login.ok).toBe(true);
    const res = await client.put("/v1/operator", { currentPassword: "not-the-password", newPassword: makeAdminCredentials().password });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(statusOf(res)).toBe(401);
    // 以前の資格情報で、まだログインできる
    const again = await createApiClient({ baseUrl: API_BASE_URL, caPath: API_CA_PATH }).post(LOGIN, { username: admin.username, password: admin.password });
    expect(again.ok).toBe(true);
  });

  test("2.9: 現在のパスワードで管理者を変更すると、新しい資格情報でログインできる", async () => {
    const admin = await loadAdmin();
    const next = makeAdminCredentials();
    const client = apiClient();
    await client.post(LOGIN, { username: admin.username, password: admin.password });
    const res = await client.put("/v1/operator", { currentPassword: admin.password, newPassword: next.password });
    expect(res.ok, "管理者の変更が成功しない").toBe(true);

    const fresh = createApiClient({ baseUrl: API_BASE_URL, caPath: API_CA_PATH });
    expect((await fresh.post(LOGIN, { username: admin.username, password: next.password })).ok).toBe(true);
    await saveAdmin({ username: admin.username, password: next.password });
  });
});
