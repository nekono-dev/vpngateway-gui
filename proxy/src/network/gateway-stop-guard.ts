// 責務: 通常停止 signal を受け、Gateway guard の lease 失効後に停止処理を一度だけ実行する。

export type GatewayStopSignal = "SIGTERM" | "SIGINT" | "SIGQUIT";

export interface GatewayStopHandlerOptions {
  signals: Pick<NodeJS.Process, "once">;
  beginShutdown: () => void | Promise<void>;
  expireLease: () => Promise<void>;
  stopControllers?: readonly (() => void | Promise<void>)[];
  close: () => Promise<void>;
  exit: (code: number) => void;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}

// queue drain・lease 失効・close を通した停止全体の既定上限。正常時は Node の signal 終了値を維持し、失敗/期限超過は 1。
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;

/** signal handler を登録し、同じ停止処理をテストや上位の終了処理からも呼べるようにする。 */
export function installGatewayStopHandlers(options: GatewayStopHandlerOptions): (signal: GatewayStopSignal) => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (signal: GatewayStopSignal): Promise<void> => {
    shutdownPromise ??= runShutdown(signal);
    return shutdownPromise;
  };

  for (const signal of ["SIGTERM", "SIGINT", "SIGQUIT"] as const) {
    options.signals.once(signal, () => { void shutdown(signal); });
  }
  return shutdown;

  function runShutdown(signal: GatewayStopSignal): Promise<void> {
    let finished = false;
    let deadlineHit = false;
    let failed = false;
    let closePromise: Promise<void> | undefined;
    const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    const exitCode = signal === "SIGTERM" ? 143 : signal === "SIGINT" ? 130 : 131;
    let resolveDeadline!: () => void;
    const deadlinePromise = new Promise<void>((resolve) => { resolveDeadline = resolve; });
    const exitOnce = (code: number): void => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      options.exit(code);
    };
    const closeOnce = (): Promise<void> => {
      closePromise ??= (async () => {
        try {
          await options.close();
        } catch (error) {
          failed = true;
          options.onError?.(error);
          throw error;
        }
      })();
      return closePromise;
    };
    const deadline = setTimeout(() => {
      deadlineHit = true;
      options.onError?.(new Error(`gateway shutdown deadline exceeded after ${timeoutMs}ms`));
      void closeOnce().catch(() => undefined);
      exitOnce(1);
      resolveDeadline();
    }, timeoutMs);

    const cleanup = (async () => {
      try {
        await options.beginShutdown();
      } catch (error) {
        failed = true;
        options.onError?.(error);
      }

      try {
        await options.expireLease();
      } catch (error) {
        failed = true;
        options.onError?.(error);
      }

      if (!deadlineHit && options.stopControllers !== undefined) {
        await Promise.all(options.stopControllers.map(async (stop) => {
          try {
            await stop();
          } catch (error) {
            failed = true;
            options.onError?.(error);
          }
        }));
      }

      try {
        await closeOnce();
      } catch {
        // closeOnce reports the failure and sets a non-zero exit status below.
      }
      if (!deadlineHit) exitOnce(failed ? 1 : exitCode);
    })();
    return Promise.race([cleanup, deadlinePromise]);
  }
}
