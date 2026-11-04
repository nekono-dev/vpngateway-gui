// 責務: 検証サーバの URL・取り込んだ CA の場所・成果物の場所を読む。秘密は受け付けない。
// 手動起動の検査（CI 環境からの起動の拒否）もここで行う（要件 7.1・7.2）。

import { readFileSync } from "node:fs";

/** 本ツールの設定。秘密を含まない（要件 1.7）。 */
export interface LiveConfig {
  readonly apiBaseUrl: string;   // 例: https://192.168.3.240:3000
  readonly caPath: string;       // 検証サーバの API の証明書を発行した CA（開発サーバへ取り込んだ PEM）
  readonly artifactsDir: string; // 成果物の書き出し先
}

/** 開発者のユーザー設定ファイルの既定の場所（`*.local.json` として git の対象外）。 */
export const DEFAULT_CONFIG_PATH = "e2e/vendor-live/config.local.json";

/** 設定ファイルに書いてよいキー。これ以外は受け付けない。 */
const ALLOWED_KEYS = ["apiBaseUrl", "caPath", "artifactsDir"] as const;

/** CI 環境で設定される環境変数。1 つでも設定されていれば起動を拒否する。 */
const CI_ENV_NAMES = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "BUILDKITE"] as const;

/**
 * 目的: CI 環境からの起動を拒否する（要件 7.2）。本試験は開発者が端末で手動で起動する。
 * 入力: env(環境変数。通常は process.env)。
 * 出力: なし。CI 環境なら例外を投げる。
 * 例: assertNotCi({ CI: "true" }) // => 例外
 */
export function assertNotCi(env: NodeJS.ProcessEnv): void {
  const found = CI_ENV_NAMES.find((name) => {
    const value = env[name];
    return value !== undefined && value !== "" && value !== "0" && value !== "false";
  });
  if (found !== undefined) {
    throw new Error(`CI 環境（${found}）からは起動できない。本試験は開発者が端末から手動で起動する`);
  }
}

/**
 * 目的: 設定ファイルの内容を検査し、LiveConfig にする。秘密を含むキーは拒否する（要件 1.7・5.4）。
 * 入力: raw(設定ファイルの JSON の文字列)。
 * 出力: LiveConfig。
 * 失敗時の方針: JSON が不正、キーが余分、URL が https でない、必須の値が無い場合は例外を投げる。
 */
export function parseConfig(raw: string): LiveConfig {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("設定ファイルは JSON のオブジェクトである必要がある");
  }
  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      // 値は表示しない（秘密が含まれている可能性があるため）
      throw new Error(`設定ファイルに許可されていないキー「${key}」がある。資格情報は設定ファイルに書かない`);
    }
  }

  const apiBaseUrl = requireString(record, "apiBaseUrl");
  if (!apiBaseUrl.startsWith("https://")) {
    throw new Error("apiBaseUrl は https で始まる必要がある（証明書を検証するため）");
  }
  return {
    apiBaseUrl,
    caPath: requireString(record, "caPath"),
    artifactsDir: typeof record.artifactsDir === "string" ? record.artifactsDir : "e2e/artifacts/vendor-live",
  };
}

/**
 * 目的: 既定の設定ファイルを読み、LiveConfig を得る。CI 環境からは読まずに拒否する。
 * 入力: env(環境変数)、path(設定ファイルの場所。既定は DEFAULT_CONFIG_PATH)。
 * 出力: LiveConfig。
 * 失敗時の方針: 設定ファイルが無ければ、作成すべき内容を含む例外を投げる。
 */
export function loadConfig(env: NodeJS.ProcessEnv, path: string = DEFAULT_CONFIG_PATH): LiveConfig {
  assertNotCi(env);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`設定ファイル（${path}）が無い。apiBaseUrl・caPath を書いて作成する`);
  }
  return parseConfig(raw);
}

/**
 * 目的: 設定ファイルの必須の文字列の値を取り出す。
 * 入力: record(設定の内容)、key(キー名)。
 * 出力: 空でない文字列。
 */
function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") throw new Error(`設定の「${key}」が無い`);
  return value;
}
