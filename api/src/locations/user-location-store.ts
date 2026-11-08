// 責務: 運用者が保存した利用者の国（ISO 国コード）を、$STATE_DIR/user-location.json に読み書きする。
// 単一の JSON ファイル。未保存・壊れている・形式が不正なら未保存として扱い、例外を投げない（表示の補助情報のため）。
// 同時書き込みは排他しない（運用者が一人で、更新が低頻度のため。表示設定と同じ作法）。

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDir } from "../providers/provider-state-paths.js";

// 国コードの形式（大文字の英字 2〜3 文字。3 文字はデータ源の識別キー用）。
const COUNTRY_PATTERN = /^[A-Z]{2,3}$/;

/**
 * 目的: 保存先のパスを返す（STATE_DIR を読み直すため、テストで差し替えられる）。
 */
function userLocationFile(): string {
  return join(stateDir(), "user-location.json");
}

/**
 * 目的: 保存された利用者の国を読み出す。
 * 出力: 国コード。未保存・壊れている・形式が不正なら undefined。
 */
export function readSavedUserCountry(): string | undefined {
  const file = userLocationFile();
  if (!existsSync(file)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const country = typeof parsed === "object" && parsed !== null ? (parsed as { country?: unknown }).country : undefined;
    return typeof country === "string" && COUNTRY_PATTERN.test(country) ? country : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 目的: 利用者の国を保存する。
 * 入力: country（ISO 国コード。大文字。既知の国であることは呼び出し元が確かめる）。
 * 副作用: 保存先のディレクトリを作り、ファイルへ書き込む。書き込みの失敗は例外として呼び出し元へ伝える。
 */
export function saveUserCountry(country: string): void {
  const file = userLocationFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ country }));
}

/**
 * 目的: 保存された利用者の国を消す（既定値へ戻す）。未保存なら何もしない。
 */
export function clearSavedUserCountry(): void {
  const file = userLocationFile();
  if (existsSync(file)) unlinkSync(file);
}
