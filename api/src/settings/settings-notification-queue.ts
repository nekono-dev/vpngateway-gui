// 責務: API 内の Gateway 設定通知を FIFO で直列化し、待機期限切れ処理を破棄する。

import { notifySettings } from "../proxy-client/proxy-client.js";
import { getSettings, toGatewaySettings } from "./settings-store.js";

interface QueueEntry<T> {
  operation: () => Promise<T> | T;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
  waitTimeoutMs?: number;
  timer?: ReturnType<typeof setTimeout>;
  started: boolean;
  cancelled: boolean;
  projection?: (settings: unknown) => unknown;
  guardEnabled?: (settings: unknown) => boolean;
  guardAffecting?: boolean;
}

export class SettingsQueueWaitTimeoutError extends Error {
  constructor(readonly errorCode?: "kill_switch_not_applied" | "gateway_setting_not_applied") {
    super("settings notification queue wait timed out");
    this.name = "SettingsQueueWaitTimeoutError";
  }
}

export class SettingsNotificationQueue {
  // ガード項目に触れ、有効値変更が投影で確定するか先行ガード PUT の失敗で変わり得る場合は5秒待つ。
  // 判定はキュー投入時の投影と先行未完了 PUT から行い、実際の通知・保存判断は先頭で永続値からやり直す。
  private readonly entries: QueueEntry<unknown>[] = [];
  private active = false;
  private activeEntry?: QueueEntry<unknown>;

  get pendingCount(): number {
    return this.entries.length;
  }

  run<T>(operation: () => Promise<T> | T, waitTimeoutMs?: number): Promise<T> {
    return this.enqueue(operation, waitTimeoutMs);
  }

  runProjected<T, S>(
    operation: () => Promise<T> | T,
    patch: (settings: S) => S,
    getPersistedSettings: () => S,
    isGuardEnabled: (settings: S) => boolean,
    touchesGuard: boolean,
    waitTimeoutMs: number,
    classify: (before: S, after: S) => "kill_switch_not_applied" | "gateway_setting_not_applied",
  ): Promise<T> {
    const projection = (settings: unknown): unknown => patch(settings as S);
    const guardEnabled = (settings: unknown): boolean => isGuardEnabled(settings as S);
    let projected = getPersistedSettings();
    for (const prior of [this.activeEntry, ...this.entries]) {
      if (prior?.projection) projected = prior.projection(projected) as S;
    }
    const effectiveChange = guardEnabled(projected) !== guardEnabled(projection(projected));
    const earlierGuardPutPending = [this.activeEntry, ...this.entries].some((prior) => prior?.guardAffecting === true);
    const shouldWaitWithLimit = touchesGuard && (effectiveChange || earlierGuardPutPending);
    const errorCode = shouldWaitWithLimit ? classify(projected, projection(projected) as S) : undefined;
    return this.enqueue(operation, shouldWaitWithLimit ? waitTimeoutMs : undefined, projection, guardEnabled, errorCode, touchesGuard);
  }

  private enqueue<T>(
    operation: () => Promise<T> | T,
    waitTimeoutMs?: number,
    projection?: (settings: unknown) => unknown,
    guardEnabled?: (settings: unknown) => boolean,
    timeoutErrorCode?: "kill_switch_not_applied" | "gateway_setting_not_applied",
    guardAffecting = false,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = { operation, resolve, reject, waitTimeoutMs, started: false, cancelled: false, projection, guardEnabled, guardAffecting };
      if (waitTimeoutMs !== undefined && this.active) {
        entry.timer = setTimeout(() => {
          if (entry.started) return;
          entry.cancelled = true;
          const index = this.entries.indexOf(entry as QueueEntry<unknown>);
          if (index !== -1) this.entries.splice(index, 1);
          reject(new SettingsQueueWaitTimeoutError(timeoutErrorCode));
        }, waitTimeoutMs);
      }
      this.entries.push(entry as QueueEntry<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    if (this.active) return;
    const entry = this.entries.shift();
    if (!entry) return;
    if (entry.cancelled) {
      this.drain();
      return;
    }

    this.active = true;
    this.activeEntry = entry;
    entry.started = true;
    if (entry.timer) clearTimeout(entry.timer);
    Promise.resolve()
      .then(entry.operation)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active = false;
        this.activeEntry = undefined;
        this.drain();
      });
  }
}

export const settingsNotificationQueue = new SettingsNotificationQueue();

/**
 * 目的: 起動通知を再試行を含めてキューの1単位で実行し、順番が来てから永続設定を読む。
 * 入力: 最終試行の失敗を記録する関数。
 * 出力: 起動通知処理の完了を示す Promise。
 */
export function notifyStartupSettings(onFinalFailure: (error: unknown) => void): Promise<void> {
  return settingsNotificationQueue.run(async () => {
    const retryDelaysMs = [500, 1000, 2000];
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        await notifySettings(toGatewaySettings(getSettings()));
        return;
      } catch (error) {
        if (attempt === retryDelaysMs.length) {
          onFinalFailure(error);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }
    }
  });
}

/**
 * 目的: 周期再通知で、キューの順番が来てから永続設定を読み Gateway へ通知する。
 * 入力: なし。
 * 出力: 通知処理の完了を示す Promise。
 */
export function notifyCurrentSettings(): Promise<unknown> {
  return settingsNotificationQueue.run(() => notifySettings(toGatewaySettings(getSettings())));
}
