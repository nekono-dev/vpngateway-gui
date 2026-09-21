// 責務: pickFailureOutput（失敗時の診断テキスト選択）の単体テスト。

import { describe, expect, it } from "vitest";
import { pickFailureOutput } from "./failure-output.js";

describe("pickFailureOutput", () => {
  it("stderrがあればそれを優先する（前後空白とANSIを除去）", () => {
    expect(pickFailureOutput("\x1B[31merror\x1B[0m\n", "ignored")).toBe("error");
  });

  it("stderrが空白のみならstdoutを返す（実CLIはエラーをstdoutへ出す）", () => {
    expect(pickFailureOutput("  \n", "Failed to disconnect. Process is not running\n")).toBe(
      "Failed to disconnect. Process is not running",
    );
  });

  it("どちらも空なら空文字列", () => {
    expect(pickFailureOutput("", "")).toBe("");
  });
});
