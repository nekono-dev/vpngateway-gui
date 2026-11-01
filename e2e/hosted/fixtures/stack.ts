// 責務: stack 群の試験で使う共通の部品。API への接続（CA で検証）と、試験の管理者の資格情報の共有（作業場所のみ）。
// 管理者の資格情報は、ui 群が作って作業場所（git の対象外）へ書き、api 群が読む。成果物には含めない。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApiClient, type ApiClient } from "../../common/api-client";
import type { AdminCredentials } from "./admin";

/** 作業場所（provision.sh の E2E_WORK_DIR）。 */
export const WORK = "e2e/hosted/.work";
/** 導入の API の入口（API のポートは導入の既定の 3000）。 */
export const API_BASE_URL = "https://127.0.0.1:3000";
/** 導入の API の CA（provision_export_ca が複製したもの）。 */
export const API_CA_PATH = join(WORK, "api-ca.crt");

/** 目的: 導入の API に、CA で検証する HTTPS クライアントを作る。 */
export function apiClient(): ApiClient {
  return createApiClient({ baseUrl: API_BASE_URL, caPath: API_CA_PATH });
}

/** 目的: ui 群が作った管理者の資格情報を、作業場所へ書く（権限 0600）。 */
export async function saveAdmin(credentials: AdminCredentials): Promise<void> {
  await mkdir(WORK, { recursive: true });
  await writeFile(join(WORK, "admin.json"), `${JSON.stringify(credentials)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** 目的: 作業場所から、管理者の資格情報を読む（無ければ例外）。 */
export async function loadAdmin(): Promise<AdminCredentials> {
  return JSON.parse(await readFile(join(WORK, "admin.json"), "utf8")) as AdminCredentials;
}

/** 導入の runner コンテナの名（compose の既定のプロジェクト名 vpngwgui）。 */
export function runnerContainer(vendor: "protonvpn" | "adguardvpn"): string {
  return `vpngwgui-runner-${vendor}-1`;
}

/**
 * 目的: モック CLI の制御（障害の注入）を、ランナーのコンテナの状態ファイルへ書く。
 * 入力: vendor、control（制御の内容。空オブジェクトで制御を解除する）。
 * 出力: なし（書けなければ例外）。
 */
export async function setMockControl(vendor: "protonvpn" | "adguardvpn", control: Record<string, unknown>): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const json = JSON.stringify(control);
  await run("sudo", ["docker", "exec", runnerContainer(vendor), "sh", "-c", `printf '%s' '${json}' > /var/lib/mockvpn/${vendor}.control.json`]);
}
