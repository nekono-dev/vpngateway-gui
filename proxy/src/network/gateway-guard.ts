// 責務: API settings 適用後の Gateway guard 状態遷移と健康時の lease 更新を管理する。

import {
  buildGuardLeaseRefreshBatch,
  buildGuardStateBatch,
  GUARD_LEASE_TIMEOUT_SECONDS,
  type GuardState,
} from "./guard-ruleset.js";
import { runNftScript, type NftResult } from "./nft-client.js";

export type GatewayGuardState = GuardState | "UNKNOWN";

export interface GatewayGuardSettings {
  killSwitch: boolean;
  transparentGatewayEnabled: boolean;
}

export interface GatewayGuardStatus {
  state: GatewayGuardState;
  healthy: boolean;
  leaseValid: boolean;
  lastUpdatedAt: string | null;
}

export interface GatewayGuardOptions {
  intervalMs?: number;
  now?: () => Date;
  listenerAvailable?: boolean;
  onEvent?: (event: Record<string, unknown>) => void;
}

const LEASE_REFRESH_INTERVAL_MS = 1000;

export class GatewayGuard {
  private state: GatewayGuardState = "UNKNOWN";
  private healthy = false;
  private listenerAvailable: boolean;
  private settings: GatewayGuardSettings | undefined;
  private lastUpdatedAt: string | null = null;
  private leaseExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private stopping = false;
  private readonly interval: ReturnType<typeof setInterval>;
  private readonly options: Required<Pick<GatewayGuardOptions, "intervalMs" | "now">> & Pick<GatewayGuardOptions, "onEvent">;

  constructor(
    private readonly lanIface: string,
    private readonly runNft: (script: string) => Promise<NftResult> = runNftScript,
    options: GatewayGuardOptions = {},
  ) {
    this.options = {
      intervalMs: options.intervalMs ?? LEASE_REFRESH_INTERVAL_MS,
      now: options.now ?? (() => new Date()),
      onEvent: options.onEvent,
    };
    this.listenerAvailable = options.listenerAvailable ?? true;
    // 初回 settings 前は timer が動いても何も適用せず、既存 guard state に触れない。
    this.interval = setInterval(() => {
      if (!this.stopping) void this.enqueue(() => this.refreshLease());
    }, this.options.intervalMs);
  }

  /** Gateway ruleset を先に適用し、成功した settings だけ guard へ反映する。 */
  applySettings(settings: GatewayGuardSettings, applyGatewayRuleset: () => Promise<boolean>): Promise<boolean> {
    if (this.stopping) return Promise.resolve(false);
    const state: GuardState = settings.killSwitch && settings.transparentGatewayEnabled ? "LEASE" : "OFF";
    return this.enqueue(async () => {
      if (this.stopping) return false;
      const applyGuardState = async (): Promise<boolean> => {
        const result = await this.runBatch(buildGuardStateBatch(state, this.lanIface));
        if (result.exitCode === 0) return true;
        this.healthy = false;
        this.emit({ event: "gateway_guard_apply_error", state, lastUpdatedAt: this.lastUpdatedAt, message: result.stderr.trim() });
        return false;
      };
      const applyGateway = async (): Promise<boolean> => {
        try {
          if (await applyGatewayRuleset()) return true;
        } catch (error) {
          this.emit({
            event: "gateway_guard_gateway_apply_error",
            state: this.state,
            lastUpdatedAt: this.lastUpdatedAt,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        this.healthy = false;
        this.emit({ event: "gateway_guard_gateway_apply_failed", state: this.state, lastUpdatedAt: this.lastUpdatedAt });
        return false;
      };

      // 状態にかかわらず Gateway ruleset を先に適用し、成功後に guard batch を実行する。
      const succeeded = await applyGateway() && await applyGuardState();
      if (!succeeded) return false;

      this.state = state;
      this.settings = settings;
      this.healthy = this.listenerAvailable;
      this.lastUpdatedAt = this.options.now().toISOString();
      this.clearLeaseExpiryTimer();
      this.emit({ event: "gateway_guard_state_changed", state, healthy: this.healthy, lastUpdatedAt: this.lastUpdatedAt });
      return this.healthy;
    });
  }

  /** 現在の guard 状態を status endpoint 用に読み取る。 */
  getStatus(): GatewayGuardStatus {
    return {
      state: this.state,
      healthy: this.healthy,
      leaseValid: this.state === "LEASE" && this.lastUpdatedAt !== null &&
        this.options.now().getTime() < Date.parse(this.lastUpdatedAt) + GUARD_LEASE_TIMEOUT_SECONDS * 1000,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  /** Gateway ruleset の検証失敗など、外部で健康条件を失ったとき lease 更新を止める。 */
  markUnhealthy(reason: string): void {
    if (this.stopping || !this.healthy) return;
    this.healthy = false;
    this.emit({ event: "gateway_guard_unhealthy", state: this.state, lastUpdatedAt: this.lastUpdatedAt, reason });
    this.scheduleLeaseExpiryEvent();
  }

  /** listener 稼働状態を Gateway reconcile とは独立した健康条件として反映する。 */
  setListenerAvailable(available: boolean): void {
    if (this.stopping || this.listenerAvailable === available) return;
    this.listenerAvailable = available;
    if (!available) {
      this.markUnhealthy("gateway_listener_unavailable");
      return;
    }
    if (this.settings !== undefined) this.handleGatewayReconcileResult(true);
  }

  /** Gateway の再構成結果を受け、失敗時は停止し、回復成功時は guard と lease を再適用する。 */
  handleGatewayReconcileResult(ok: boolean, error?: string): void {
    if (this.stopping) return;
    if (!ok) {
      this.markUnhealthy(error ?? "gateway_reconcile_failed");
      return;
    }
    if (this.healthy || this.settings === undefined) return;

    void this.enqueue(async () => {
      if (this.stopping || this.healthy || !this.listenerAvailable || this.settings === undefined) return;
      const state: GuardState = this.settings.killSwitch && this.settings.transparentGatewayEnabled ? "LEASE" : "OFF";
      const result = await this.runBatch(buildGuardStateBatch(state, this.lanIface));
      if (result.exitCode !== 0) {
        this.healthy = false;
        this.emit({
          event: "gateway_guard_recovery_apply_error",
          state: this.state,
          lastUpdatedAt: this.lastUpdatedAt,
          message: result.stderr.trim(),
        });
        this.scheduleLeaseExpiryEvent();
        return;
      }

      this.state = state;
      this.healthy = true;
      this.lastUpdatedAt = this.options.now().toISOString();
      this.clearLeaseExpiryTimer();
      this.emit({ event: "gateway_guard_recovered", state, healthy: true, lastUpdatedAt: this.lastUpdatedAt });
    });
  }

  /** timer を停止する。プロセスの signal と server close の順序は停止 guard が管理する。 */
  close(): void {
    clearInterval(this.interval);
    this.clearLeaseExpiryTimer();
  }

  /** 新しい guard 操作を止め、すでに開始した直列処理が終わるまで待つ。 */
  beginShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.interval);
    this.clearLeaseExpiryTimer();
    return this.queue;
  }

  /** 通常停止時に lease を即時失効させる。OFF/BLOCK では nft state を変更しない。 */
  async expireLeaseForShutdown(): Promise<void> {
    await this.beginShutdown();
    await this.enqueue(async () => {
      this.clearLeaseExpiryTimer();
      if (this.state !== "LEASE") return;

      const result = await this.runBatch(buildGuardStateBatch("BLOCK", this.lanIface));
      if (result.exitCode !== 0) {
        this.emit({ event: "gateway_guard_shutdown_expire_error", state: this.state, lastUpdatedAt: this.lastUpdatedAt, message: result.stderr.trim() });
        throw new Error(result.stderr.trim() || "gateway guard lease expiration failed");
      }

      this.state = "BLOCK";
      this.healthy = false;
      this.emit({ event: "gateway_guard_shutdown_lease_expired", state: this.state, healthy: false, lastUpdatedAt: this.lastUpdatedAt });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async refreshLease(): Promise<void> {
    if (this.stopping || !this.healthy || this.state !== "LEASE") return;
    const result = await this.runBatch(buildGuardLeaseRefreshBatch(this.lanIface));
    if (result.exitCode !== 0) {
      this.healthy = false;
      this.emit({ event: "gateway_guard_lease_refresh_error", state: this.state, lastUpdatedAt: this.lastUpdatedAt, message: result.stderr.trim() });
      this.scheduleLeaseExpiryEvent();
      return;
    }

    this.lastUpdatedAt = this.options.now().toISOString();
    this.emit({ event: "gateway_guard_lease_refreshed", state: this.state, healthy: true, lastUpdatedAt: this.lastUpdatedAt });
  }

  private emit(event: Record<string, unknown>): void {
    this.options.onEvent?.(event);
  }

  private scheduleLeaseExpiryEvent(): void {
    this.clearLeaseExpiryTimer();
    if (this.state !== "LEASE" || this.lastUpdatedAt === null) return;
    const expiresAt = Date.parse(this.lastUpdatedAt) + GUARD_LEASE_TIMEOUT_SECONDS * 1000;
    this.leaseExpiryTimer = setTimeout(() => {
      this.emit({ event: "gateway_guard_lease_expired", state: this.state, healthy: false, lastUpdatedAt: this.lastUpdatedAt });
      this.leaseExpiryTimer = undefined;
    }, Math.max(0, expiresAt - this.options.now().getTime()));
  }

  private clearLeaseExpiryTimer(): void {
    if (this.leaseExpiryTimer !== undefined) clearTimeout(this.leaseExpiryTimer);
    this.leaseExpiryTimer = undefined;
  }

  private async runBatch(script: string): Promise<NftResult> {
    try {
      return await this.runNft(script);
    } catch (error) {
      return { exitCode: -1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
    }
  }
}
