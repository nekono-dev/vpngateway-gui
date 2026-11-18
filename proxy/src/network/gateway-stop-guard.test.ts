// 責務: 通常停止時に Gateway guard の lease 失効と終了処理の順序を検証する。

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installGatewayStopHandlers } from "./gateway-stop-guard.js";
import { GatewayGuard } from "./gateway-guard.js";
import type { NftResult } from "./nft-client.js";

const nftOk: NftResult = { exitCode: 0, stdout: "", stderr: "" };

describe("installGatewayStopHandlers", () => {
  it("SIGTERM・SIGINT・SIGQUIT を一度ずつ登録する", () => {
    const signals = new EventEmitter();
    installGatewayStopHandlers({
      signals,
      expireLease: async () => undefined,
      close: async () => undefined,
      exit: () => undefined,
    });

    expect(signals.listenerCount("SIGTERM")).toBe(1);
    expect(signals.listenerCount("SIGINT")).toBe(1);
    expect(signals.listenerCount("SIGQUIT")).toBe(1);
  });

  it.each(["SIGTERM", "SIGINT", "SIGQUIT"] as const)("%s では lease 失効後に終了処理を行う", async (signal) => {
    const signals = new EventEmitter();
    const order: string[] = [];
    const exit = vi.fn(() => order.push("exit"));
    const shutdown = installGatewayStopHandlers({
      signals,
      beginShutdown: () => { order.push("begin"); },
      expireLease: async () => { order.push("expire"); },
      stopControllers: [async () => { order.push("controller:explicit"); }, async () => { order.push("controller:dns"); }],
      close: async () => { order.push("close"); },
      exit,
    });

    const stopping = shutdown(signal);
    await stopping;

    expect(order).toEqual(["begin", "expire", "controller:explicit", "controller:dns", "close", "exit"]);
    expect(exit).toHaveBeenCalledWith(signal === "SIGTERM" ? 143 : signal === "SIGINT" ? 130 : 131);
  });

  it("controller stop failure は他の controller を止めてから非0終了する", async () => {
    const signals = new EventEmitter();
    const order: string[] = [];
    const onError = vi.fn();
    const shutdown = installGatewayStopHandlers({
      signals,
      beginShutdown: () => { order.push("begin"); },
      expireLease: async () => { order.push("expire"); },
      stopControllers: [
        async () => { order.push("controller:failed"); throw new Error("controller failed"); },
        async () => { order.push("controller:remaining"); },
      ],
      close: async () => { order.push("close"); },
      exit: (code) => { order.push(`exit:${code}`); },
      onError,
    });

    await shutdown("SIGTERM");

    expect(order).toEqual(["begin", "expire", "controller:failed", "controller:remaining", "close", "exit:1"]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "controller failed" }));
  });

  it("lease 失効に失敗しても終了処理を続ける", async () => {
    const signals = new EventEmitter();
    const order: string[] = [];
    const onError = vi.fn();
    const shutdown = installGatewayStopHandlers({
      signals,
      beginShutdown: () => { order.push("begin"); },
      expireLease: async () => { order.push("expire"); throw new Error("nft failed"); },
      close: async () => { order.push("close"); },
      exit: (code) => { order.push(`exit:${code}`); },
      onError,
    });

    await shutdown("SIGTERM");

    expect(order).toEqual(["begin", "expire", "close", "exit:1"]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("close failure は非0終了として報告する", async () => {
    const signals = new EventEmitter();
    const exit = vi.fn();
    const shutdown = installGatewayStopHandlers({
      signals,
      beginShutdown: () => undefined,
      expireLease: async () => undefined,
      close: async () => { throw new Error("close failed"); },
      exit,
    });

    await shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("期限内に失効しない場合も close を開始して deadline code で終了する", async () => {
    vi.useFakeTimers();
    const signals = new EventEmitter();
    let releaseExpiry!: () => void;
    const close = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = installGatewayStopHandlers({
      signals,
      timeoutMs: 2000,
      beginShutdown: () => undefined,
      expireLease: () => new Promise<void>((resolve) => { releaseExpiry = resolve; }),
      close,
      exit,
    });

    const stopping = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    releaseExpiry();
    await stopping;
    expect(exit).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("in-flight nft とその queue drain が停止期限を超えた場合も期限内に終了する", async () => {
    vi.useFakeTimers();
    const signals = new EventEmitter();
    let releaseNft!: (result: NftResult) => void;
    const runNft = vi.fn().mockResolvedValueOnce(nftOk).mockImplementationOnce(() => new Promise<NftResult>((resolve) => { releaseNft = resolve; }));
    const guard = new GatewayGuard("eth0", runNft);
    await guard.applySettings({ killSwitch: true, transparentGatewayEnabled: true }, async () => true);
    const inFlight = guard.applySettings({ killSwitch: false, transparentGatewayEnabled: true }, async () => true);
    await Promise.resolve();
    await Promise.resolve();

    const close = vi.fn(async () => guard.close());
    const exit = vi.fn();
    const shutdown = installGatewayStopHandlers({
      signals,
      timeoutMs: 2000,
      beginShutdown: () => guard.beginShutdown(),
      expireLease: () => guard.expireLeaseForShutdown(),
      close,
      exit,
    });
    const stopping = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(2000);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    releaseNft(nftOk);
    await Promise.all([inFlight, stopping]);
    vi.useRealTimers();
  });

  it("停止要求が重なっても終了処理を一度だけ行う", async () => {
    const signals = new EventEmitter();
    const expireLease = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const exit = vi.fn();
    const stopController = vi.fn(async () => undefined);
    const shutdown = installGatewayStopHandlers({ signals, beginShutdown: () => undefined, expireLease, stopControllers: [stopController], close, exit });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(expireLease).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(stopController).toHaveBeenCalledTimes(1);
  });

  it("controller stop が停止期限を超えても listener を閉じて期限内に終了する", async () => {
    vi.useFakeTimers();
    const signals = new EventEmitter();
    const close = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = installGatewayStopHandlers({
      signals,
      timeoutMs: 2000,
      beginShutdown: () => undefined,
      expireLease: async () => undefined,
      stopControllers: [() => new Promise<void>(() => undefined)],
      close,
      exit,
    });

    const stopping = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    await stopping;
    vi.useRealTimers();
  });
});
