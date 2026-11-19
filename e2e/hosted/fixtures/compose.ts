// 責務: hosted E2E の root Compose と vendor/TLS fragment を固定 project で操作する。

import { execFileSync } from "node:child_process";

export const COMPOSE_PROJECT = "vpngwgui";
export const HOSTED_COMPOSE_FRAGMENTS = [
  "vendors/protonvpn/compose.yml",
  "vendors/adguardvpn/compose.yml",
  "docker-compose.e2e-mock.yml",
  "e2e/hosted/vendors/protonvpn/compose.yml",
  "e2e/hosted/vendors/adguardvpn/compose.yml",
] as const;

export interface ComposeConfig {
  readonly name: string;
  readonly services: Record<string, {
    readonly environment: Record<string, string>;
    readonly ports?: readonly unknown[];
    readonly volumes?: readonly { readonly target?: string; readonly source?: string; readonly type?: string }[];
  }>;
  readonly volumes: Record<string, { readonly name: string }>;
}

export type ComposeRunner = (file: string, args: readonly string[], env?: NodeJS.ProcessEnv) => string;

const defaultRunner: ComposeRunner = (file, args, env) => execFileSync(file, [...args], {
  encoding: "utf8",
  ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
});

/** Compose CLI の全操作に固定 project と root-first の fragment 順を付ける。 */
export function composeArgs(command: readonly string[], fragments: readonly string[] = [], project = COMPOSE_PROJECT): string[] {
  return ["compose", "-p", project, "-f", "docker-compose.yml", ...fragments.flatMap((fragment) => ["-f", fragment]), ...command];
}

/** Compose command を実行する。通常の停止は named volume を保持する。 */
export function runCompose(command: readonly string[], fragments: readonly string[] = [], project = COMPOSE_PROJECT, runner: ComposeRunner = defaultRunner): string {
  try {
    return runner("docker", composeArgs(command, fragments, project));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Compose command failed (${message}); inspect the stack with docker compose -p ${project} logs`, { cause: error });
  }
}

/** 設定だけを解決し、コンテナや volume を作らず Compose の契約を検証する。 */
export function composeConfig(fragments: readonly string[] = [], env: NodeJS.ProcessEnv = {}, project = COMPOSE_PROJECT): ComposeConfig {
  const output = execFileSync("docker", composeArgs(["config", "--format", "json"], fragments, project), {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return JSON.parse(output) as ComposeConfig;
}

/** TLS fragment を指定しない HTTP 既定の構成を検査する。 */
export function validateComposeConfig(fragments: readonly string[] = [], runner: ComposeRunner = defaultRunner): void {
  runCompose(["config", "--quiet"], fragments, COMPOSE_PROJECT, runner);
}

/** root Compose を起動する。 */
export function composeUp(fragments: readonly string[] = [], runner: ComposeRunner = defaultRunner): string {
  validateComposeConfig(fragments, runner);
  return runCompose(["up", "-d", "--build"], fragments, COMPOSE_PROJECT, runner);
}

/** 資材更新を模擬し、同じ project で build 後にサービスを起動する。 */
export function composeBuildAndUp(fragments: readonly string[] = [], runner: ComposeRunner = defaultRunner): string {
  validateComposeConfig(fragments, runner);
  runCompose(["build"], fragments, COMPOSE_PROJECT, runner);
  return runCompose(["up", "-d"], fragments, COMPOSE_PROJECT, runner);
}

/** named volume を保持したまま全サービスを再作成する。 */
export function composeRecreate(fragments: readonly string[] = [], runner: ComposeRunner = defaultRunner): string {
  validateComposeConfig(fragments, runner);
  return runCompose(["up", "-d", "--force-recreate"], fragments, COMPOSE_PROJECT, runner);
}

/** volume を保持して Compose を停止する。 */
export function composeDown(fragments: readonly string[] = [], runner: ComposeRunner = defaultRunner): string {
	return runCompose(["down"], fragments, COMPOSE_PROJECT, runner);
}

/** 明示的な削除を選んだ場合だけ named volume も削除する。 */
export function composeDownVolumes(fragments: readonly string[] = [], runner: ComposeRunner = defaultRunner): string {
  return runCompose(["down", "-v"], fragments, COMPOSE_PROJECT, runner);
}
