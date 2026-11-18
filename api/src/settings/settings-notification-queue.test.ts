// 責務: 設定通知キューの直列実行・待機期限・期限切れ処理を検証する。

import { describe, expect, it, vi } from "vitest";
import { SettingsNotificationQueue, SettingsQueueWaitTimeoutError } from "./settings-notification-queue.js";

describe("SettingsNotificationQueue", () => {
  it("処理を FIFO で直列実行する", async () => {
    const queue = new SettingsNotificationQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = queue.run(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push("first:end");
    });
    const second = queue.run(async () => { order.push("second"); });

    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("待機期限を超えた処理を後から実行しない", async () => {
    const queue = new SettingsNotificationQueue();
    let releaseFirst!: () => void;
    const first = queue.run(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const lateOperation = vi.fn();
    const timed = queue.run(lateOperation, 5);

    await expect(timed).rejects.toBeInstanceOf(SettingsQueueWaitTimeoutError);
    releaseFirst();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lateOperation).not.toHaveBeenCalled();
  });

  it("期限切れの待機項目を配列から除き、後続項目を直ちに実行する", async () => {
    vi.useFakeTimers();
    try {
      const queue = new SettingsNotificationQueue();
      let releaseFirst!: () => void;
      const first = queue.run(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
      const expired = queue.run(vi.fn(), 5000);
      const nextOperation = vi.fn();
      const next = queue.run(nextOperation);

      expect(queue.pendingCount).toBe(2);
      const expiredResult = expect(expired).rejects.toBeInstanceOf(SettingsQueueWaitTimeoutError);
      await vi.advanceTimersByTimeAsync(5000);
      await expiredResult;
      expect(queue.pendingCount).toBe(1);

      releaseFirst();
      await Promise.all([first, next]);
      expect(nextOperation).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("待機中の期限は先行処理の完了時に解除する", async () => {
    const queue = new SettingsNotificationQueue();
    let releaseFirst!: () => void;
    const first = queue.run(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const operation = vi.fn();
    const second = queue.run(operation, 100);

    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    releaseFirst();
    await Promise.all([first, second]);
    expect(operation).toHaveBeenCalledOnce();
  });
});
