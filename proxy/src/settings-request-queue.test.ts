// 責務: 設定要求キューが到着順に単一実行し、失敗後も後続要求を処理することを検証する。

import { describe, expect, it } from "vitest";
import { SettingsRequestQueue } from "./settings-request-queue.js";

describe("SettingsRequestQueue", () => {
  it("非同期の設定適用を到着順に直列実行する", async () => {
    const queue = new SettingsRequestQueue();
    const calls: string[] = [];
    let finishFirst!: () => void;
    const first = queue.run(async () => {
      calls.push("first:start");
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      calls.push("first:end");
    });
    const second = queue.run(async () => { calls.push("second"); });

    await Promise.resolve();
    expect(calls).toEqual(["first:start"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(["first:start", "first:end", "second"]);
  });

  it("先頭要求の失敗を返しつつ後続要求を到着順に処理する", async () => {
    const queue = new SettingsRequestQueue();
    const calls: string[] = [];
    const failed = queue.run(async () => {
      calls.push("first");
      throw new Error("failed");
    });
    const later = queue.run(async () => {
      calls.push("second");
      return "later";
    });

    await expect(failed).rejects.toThrow("failed");
    await expect(later).resolves.toBe("later");
    expect(calls).toEqual(["first", "second"]);
  });
});
