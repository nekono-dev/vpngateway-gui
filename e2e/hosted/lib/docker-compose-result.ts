// 責務: Compose の状態出力を解析し、起動試験で使う argv と service 状態を提供する。

export interface ComposeServiceState {
  readonly service: string;
  readonly state: string;
  readonly exitCode: number;
}

/** Compose の共通 argv に `ps -a --format json` を追加する。 */
export function composePsArgs(prefix: readonly string[]): string[] {
  return [...prefix, "ps", "-a", "--format", "json"];
}

/** Compose の JSON 配列または NDJSON を service ごとの状態に変換する。 */
export function parseComposePs(output: string): ComposeServiceState[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];

  let entries: unknown;
  try {
    entries = trimmed.startsWith("[") ? JSON.parse(trimmed) : trimmed.split(/\r?\n/).map((line) => JSON.parse(line));
  } catch (error) {
    throw new Error("Compose ps JSON could not be parsed", { cause: error });
  }
  if (!Array.isArray(entries)) throw new Error("Compose ps JSON must contain an array");

  return entries.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) throw new Error("Compose ps entry must be an object");
    const fields = entry as Record<string, unknown>;
    const service = fields.Service ?? fields.service;
    const state = fields.State ?? fields.state;
    const exitCodeValue = fields.ExitCode ?? fields.exitCode ?? 0;
    const exitCode = typeof exitCodeValue === "number" ? exitCodeValue : Number(exitCodeValue);
    if (typeof service !== "string" || typeof state !== "string" || !Number.isInteger(exitCode)) {
      throw new Error("Compose ps entry requires Service, State, and an integer ExitCode");
    }
    return { service, state: state.toLowerCase(), exitCode };
  });
}
