// 責務: isCommandSuccessの単体テスト。

import { describe, expect, it } from "vitest";
import { isCommandSuccess } from "./command-success.js";

const result = (exitCode: number | null, stdout = "", stderr = "") => ({ exitCode, stdout, stderr });

describe("isCommandSuccess", () => {
  it("終了コード0は、successPatternの有無によらず成功", () => {
    expect(isCommandSuccess({}, result(0))).toBe(true);
    expect(isCommandSuccess({ successPattern: "^OK" }, result(0, "何か"))).toBe(true);
  });

  it("終了コードが0以外で、successPatternが無ければ失敗", () => {
    expect(isCommandSuccess({}, result(1, "Disconnected."))).toBe(false);
  });

  it("終了コードが0以外でも、標準出力・標準エラーがsuccessPatternに一致すれば成功", () => {
    const action = { successPattern: "^Disconnected\\." };
    expect(isCommandSuccess(action, result(1, "Disconnected.\n"))).toBe(true);
    expect(isCommandSuccess(action, result(1, "", "Disconnected."))).toBe(true);
    // 行頭一致（複数行のうち途中の行でも一致する）
    expect(isCommandSuccess(action, result(1, "log\nDisconnected.\n"))).toBe(true);
  });

  it("終了コードが0以外で、successPatternに一致しなければ失敗（タイムアウトのnullも失敗）", () => {
    const action = { successPattern: "^Disconnected\\." };
    expect(isCommandSuccess(action, result(1, "Error: Failed to disconnect"))).toBe(false);
    expect(isCommandSuccess(action, result(null))).toBe(false);
  });
});
