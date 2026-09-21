// 責務: 最後に接続に成功した接続先ID（location-id.ts）の永続化。次回の既定選択に使う（Phase 8で廃止した
// `defaultCountry`設定の代替。apiserver/design.md「接続先（ロケーション）」）。
// 接続状態（connection-state-store.ts）と異なり、切断しても消さない（「最後に接続した先」であるため）。
// 単一JSONファイルへの上書き保存。ファイルが無い・壊れている場合は未保存として扱い例外にしない。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPattern } from "../lib/regex-match.js";
import { LOCATION_ID_PATTERN } from "./location-id.js";

const LAST_LOCATION_FILE = process.env.LAST_LOCATION_FILE ?? "/var/lib/vpngwgui/last-location.json";

/**
 * 目的: 最後に接続した接続先IDを読み出す。
 * 出力: 接続先ID。未保存・破損（JSON不正・形状不正・ID形式不正）の場合はundefined。
 */
export function readLastLocationId(): string | undefined {
  if (!existsSync(LAST_LOCATION_FILE)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(LAST_LOCATION_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const id = (parsed as Record<string, unknown>).id;
    return typeof id === "string" && matchesPattern(id, LOCATION_ID_PATTERN) ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 目的: 接続に成功した接続先IDを、最後に接続した接続先として保存する。
 * 入力: locationId(接続先ID)。
 * 副作用: LAST_LOCATION_FILEへ書き込む（ディレクトリが無ければ作成）。
 */
export function saveLastLocationId(locationId: string): void {
  mkdirSync(dirname(LAST_LOCATION_FILE), { recursive: true });
  writeFileSync(LAST_LOCATION_FILE, JSON.stringify({ id: locationId }));
}
