// 責務: テスト用の名前→IP の対応表（zone/records.json）を読み、名前を引く。DoH と平文 DNS の両方が同じ表を参照する。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 対応表の 1 件。 */
export interface ZoneRecord {
  readonly name: string;
  readonly a: string;
}

/** 対応表の形（records.json と一致）。 */
export interface Zone {
  readonly records: readonly ZoneRecord[];
  // 直接の応答（中継を経由しない問い合わせに対して返す値。53 番リダイレクトの判定に使う）
  readonly directAnswers: readonly ZoneRecord[];
}

/** 既定の対応表の場所（このファイルから見た zone/records.json）。 */
export const DEFAULT_ZONE_PATH = fileURLToPath(new URL("../zone/records.json", import.meta.url));

/**
 * 目的: 対応表を読み込む。
 * 入力: path(対応表の JSON の場所)。
 * 出力: Zone。
 * 失敗時の方針: 形式が合わなければ例外を投げる（不完全な対応表で試験を進めない）。
 */
export function loadZone(path: string = DEFAULT_ZONE_PATH): Zone {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Zone>;
  if (!Array.isArray(parsed.records) || !Array.isArray(parsed.directAnswers)) {
    throw new Error(`対応表（${path}）の形式が合わない`);
  }
  return { records: parsed.records, directAnswers: parsed.directAnswers };
}

/**
 * 目的: 名前の A レコードを引く。
 * 入力: zone(対応表)、name(問い合わせの名前。末尾のドットと大文字小文字は無視する)、direct(直接の応答を優先するか)。
 * 出力: IPv4 の文字列。対応が無ければ null（NXDOMAIN として扱う）。
 */
export function lookupA(zone: Zone, name: string, direct = false): string | null {
  const key = name.replace(/\.$/, "").toLowerCase();
  const table = direct ? [...zone.directAnswers, ...zone.records] : zone.records;
  return table.find((record) => record.name.toLowerCase() === key)?.a ?? null;
}
