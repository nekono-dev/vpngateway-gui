// 責務: 表示設定（テーマ）の永続化。`$STATE_DIR/ui-preferences.json` へ単一のJSONとして読み書きする。
// 運用設定（settings-store.ts）とは分けている。表示だけの値の変更で、プロキシへの通知を伴わないため。
// 同時書き込みの排他は行わない（単一管理者・低頻度更新のため。settings-store.ts と同じ作法）。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { stateDir } from "../providers/provider-state-paths.js";
import {
  ThemePreferenceSchema,
  type UiPreferences,
  type UiPreferencesUpdateBody,
} from "../schemas/ui-preferences.js";

// 未保存・読めない・値が不正な場合の既定。
const DEFAULT_UI_PREFERENCES: UiPreferences = { theme: "system" };

/**
 * 目的: 保存先のパスを返す。STATE_DIR を読み直すため、テストで差し替えられる。
 * 入力: なし。
 * 出力: `$STATE_DIR/ui-preferences.json` のパス。
 */
function uiPreferencesFilePath(): string {
  return join(stateDir(), "ui-preferences.json");
}

/**
 * 目的: 表示設定を取得する。未保存・ファイルが壊れている・値が3種類以外の場合は既定（system）を返す。
 * 入力: なし。
 * 出力: UiPreferences（theme は必ず3種類のいずれか）。
 * 失敗時の方針: 例外を投げず、既定へ丸める（表示の補助情報のため、画面を止めない）。
 */
export function getUiPreferences(): UiPreferences {
  const file = uiPreferencesFilePath();
  if (!existsSync(file)) {
    return { ...DEFAULT_UI_PREFERENCES };
  }
  try {
    const stored: unknown = JSON.parse(readFileSync(file, "utf8"));
    const theme = typeof stored === "object" && stored !== null ? (stored as { theme?: unknown }).theme : undefined;
    if (Value.Check(ThemePreferenceSchema, theme)) {
      return { theme };
    }
    return { ...DEFAULT_UI_PREFERENCES };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

/**
 * 目的: 表示設定を保存する。
 * 入力: body（検証済みの要求。theme は3種類のいずれか。検証は呼び出し元のルートで行う）。
 * 出力: 保存後の UiPreferences。
 * 副作用: 保存先のディレクトリを作り、ファイルへ書き込む。書き込みの失敗は例外として呼び出し元へ伝える。
 */
export function updateUiPreferences(body: UiPreferencesUpdateBody): UiPreferences {
  const file = uiPreferencesFilePath();
  mkdirSync(dirname(file), { recursive: true });
  const next: UiPreferences = { theme: body.theme };
  writeFileSync(file, JSON.stringify(next));
  return next;
}
