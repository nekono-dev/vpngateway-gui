// 責務: リクエストボディの中断・期限切れで読み取りが確実に終了することを検証する。

import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { readRequestBody } from "./http-json.js";
import { SettingsRequestQueue } from "../settings-request-queue.js";

function createRequest(): EventEmitter & { complete: boolean; aborted: boolean; destroyed: boolean } {
  return Object.assign(new EventEmitter(), { complete: false, aborted: false, destroyed: false });
}

describe("readRequestBody", () => {
  it("aborted の後にrejectし、キューの次要求を実行できる", async () => {
    const queue = new SettingsRequestQueue();
    const request = createRequest();
    const first = queue.run(() => readRequestBody(request as IncomingMessage, 100));
    const second = queue.run(async () => "second");

    await Promise.resolve();
    request.emit("aborted");

    await expect(first).rejects.toThrow(/aborted/i);
    await expect(second).resolves.toBe("second");
  });

  it("不完全な request の close でrejectする", async () => {
    const request = createRequest();
    const body = readRequestBody(request as IncomingMessage, 100);
    request.emit("close");
    await expect(body).rejects.toThrow(/closed/i);
  });

  it("本文を読み終えない場合は期限内にrejectする", async () => {
    const request = createRequest();
    await expect(readRequestBody(request as IncomingMessage, 10)).rejects.toThrow(/timed out/i);
  });
});
