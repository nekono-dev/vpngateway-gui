// 責務: 運用者が保存した利用者の国の読み書き・削除、未保存・壊れたファイルの扱いを確かめる。
import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "vpngwgui-user-location-"));
  process.env.STATE_DIR = stateDir;
});

const { readSavedUserCountry, saveUserCountry, clearSavedUserCountry } = await import("./user-location-store.js");

describe("利用者の場所の保存", () => {
  it("未保存のときは undefined", () => {
    expect(readSavedUserCountry()).toBeUndefined();
  });

  it("保存した国を読み直せる。保存先は $STATE_DIR/user-location.json", () => {
    saveUserCountry("JP");
    expect(readSavedUserCountry()).toBe("JP");
    expect(JSON.parse(readFileSync(join(stateDir, "user-location.json"), "utf8"))).toEqual({ country: "JP" });
  });

  it("削除すると未保存に戻る（既定値へ戻す）", () => {
    saveUserCountry("US");
    clearSavedUserCountry();
    expect(readSavedUserCountry()).toBeUndefined();
  });

  it("壊れたファイル・形式が不正な値は未保存として扱う（例外にしない）", () => {
    writeFileSync(join(stateDir, "user-location.json"), "{not json");
    expect(readSavedUserCountry()).toBeUndefined();
    writeFileSync(join(stateDir, "user-location.json"), JSON.stringify({ country: "japan!" }));
    expect(readSavedUserCountry()).toBeUndefined();
  });
});
