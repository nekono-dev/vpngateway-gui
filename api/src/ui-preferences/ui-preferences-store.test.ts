// 責務: 表示設定（テーマ）の保存・読み込みの単体テスト（未保存・読み直し・破損・不正値の扱い）。

import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "vpngwgui-ui-prefs-"));
  process.env.STATE_DIR = stateDir;
});

const { getUiPreferences, updateUiPreferences } = await import("./ui-preferences-store.js");

describe("表示設定ストア", () => {
  it("未保存のときは OS 規定（system）を返す", () => {
    expect(getUiPreferences()).toEqual({ theme: "system" });
  });

  it("保存した値を読み直すと同じ値が返る", () => {
    updateUiPreferences({ theme: "dark" });
    expect(getUiPreferences()).toEqual({ theme: "dark" });
  });

  it("保存先は状態ディレクトリ配下の ui-preferences.json になる", () => {
    updateUiPreferences({ theme: "light" });
    const saved = JSON.parse(readFileSync(join(stateDir, "ui-preferences.json"), "utf8"));
    expect(saved).toEqual({ theme: "light" });
  });

  it("壊れた JSON のファイルは例外にせず、OS 規定として扱う", () => {
    writeFileSync(join(stateDir, "ui-preferences.json"), "{ not json");
    expect(getUiPreferences()).toEqual({ theme: "system" });
  });

  it("3種類以外の値が保存されていても、OS 規定として扱う", () => {
    writeFileSync(join(stateDir, "ui-preferences.json"), JSON.stringify({ theme: "auto" }));
    expect(getUiPreferences()).toEqual({ theme: "system" });
  });

  it("壊れたファイルがあっても、次の保存で正しい値に上書きできる", () => {
    writeFileSync(join(stateDir, "ui-preferences.json"), "{ not json");
    updateUiPreferences({ theme: "dark" });
    expect(getUiPreferences()).toEqual({ theme: "dark" });
  });
});
