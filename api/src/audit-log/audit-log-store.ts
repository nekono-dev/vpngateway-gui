// 責務: すべてのコマンド実行要求・結果を構造化ログ(JSONL)として記録し、事後追跡できるようにする。
// 現時点で認証機構がないため、事後追跡性の確保が重要になる（apiserver/requirements.md参照）。

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditLogEntry } from "../schemas/audit-log.js";

const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE ?? "/var/lib/vpngwgui/audit.log";
const DEFAULT_READ_LIMIT = 100;

/**
 * 目的: 監査ログ1件を追記する。
 * 入力: entry(timestampを除くログ内容。timestampはこの関数が付与する)。
 * 出力: なし。
 * 副作用: AUDIT_LOG_FILEへ1行(JSON)追記する。
 */
export function appendAuditLog(entry: Omit<AuditLogEntry, "timestamp">): void {
  const full: AuditLogEntry = { timestamp: new Date().toISOString(), ...entry };
  mkdirSync(dirname(AUDIT_LOG_FILE), { recursive: true });
  appendFileSync(AUDIT_LOG_FILE, JSON.stringify(full) + "\n");
}

/**
 * 目的: 直近の監査ログを新しい順ではなく記録順のまま取得する。
 * 入力: limit(取得する最大件数、省略時100件)。
 * 出力: AuditLogEntryの配列（末尾limit件、記録順）。
 */
export function readAuditLog(limit: number = DEFAULT_READ_LIMIT): AuditLogEntry[] {
  if (!existsSync(AUDIT_LOG_FILE)) {
    return [];
  }
  const lines = readFileSync(AUDIT_LOG_FILE, "utf8").trim().split("\n").filter((line) => line.length > 0);
  return lines.slice(-limit).map((line) => JSON.parse(line));
}
