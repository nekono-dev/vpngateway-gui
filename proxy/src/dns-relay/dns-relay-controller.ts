// 責務: DNS中継リゾルバの起動・停止・設定反映と、現在の稼働状況（`GET /net/status`用）の保持。
// 問い合わせの処理（relay.ts）・待受（listener.ts）とは分離し、本ファイルは「いつ起動・停止・再構成するか」の
// 調停のみを行う（GatewayController・ExplicitProxyControllerと同じ責務分離）。proxyserver/design.md「設定の反映と状態」参照。

import { ClientIdResolver } from "./client-id.js";
import { DnsListener } from "./listener.js";
import { DnsRelay, type BypassAddress, type DnsRelayConfig } from "./relay.js";
import { isValidDomainPattern } from "./domain-matcher.js";

export interface DnsRelaySettings extends DnsRelayConfig {
  enabled: boolean;
}

// active: 待受中 / stopped: 無効 / unconfigured: 有効設定だが上流もフォールバック先も空 / error: 待受に失敗（ポート衝突等）。
export type DnsRelayState = "active" | "stopped" | "unconfigured" | "error";

// `GET /net/status`が返す稼働状況（apiserver/design.md「稼働状況取得」と同形状）。
export interface DnsRelayStatus {
  state: DnsRelayState;
  // 上流の疎通。ok: 直近の転送が成功 / failing: 直近の転送が失敗 / unknown: まだ転送していない。
  upstream: "ok" | "failing" | "unknown";
  // 保持中（期限内）の迂回対象アドレス数。
  bypassEntries: number;
}

export interface DnsRelayControllerOptions {
  port: number;
  // 待ち受けるIPv4アドレス（ゲートウェイのLAN側アドレスと127.0.0.1）。
  listenAddresses: readonly string[];
  // 迂回対象のアドレスの登録先と、保持数の取得元（GatewayController）。
  registerBypass: (addresses: readonly BypassAddress[]) => Promise<void> | void;
  bypassEntryCount: () => number;
  onEvent?: (event: Record<string, unknown>) => void;
  // テスト用フック。
  listener?: Pick<DnsListener, "start" | "stop">;
  relay?: DnsRelay;
}

/**
 * 目的: 迂回ドメインの一覧から、不正な表記を除いたものを返す（APIサーバでも検証済みだが、最後の防波堤として再検証する）。
 */
export function sanitizeExcludedDomains(domains: readonly string[]): string[] {
  return domains.filter((domain) => isValidDomainPattern(domain));
}

export class DnsRelayController {
  private settings: DnsRelaySettings = {
    enabled: false,
    excludedDomains: [],
    upstreamUrl: "",
    upstreamCaPem: "",
    failureMode: "failClosed",
    fallbackServers: [],
  };
  private state: DnsRelayState = "stopped";
  private listening = false;
  // 反映処理（起動・停止）の直列化。
  private queue: Promise<void> = Promise.resolve();
  private hasApplied = false;
  private fallbackReported = false;
  private readonly listener: Pick<DnsListener, "start" | "stop">;
  private readonly relay: DnsRelay;

  constructor(private readonly options: DnsRelayControllerOptions) {
    this.listener = options.listener ?? new DnsListener();
    this.relay =
      options.relay ??
      new DnsRelay({
        clientIds: new ClientIdResolver(["127.0.0.1"]),
        registerBypass: (addresses) => options.registerBypass(addresses),
        onUpstreamStateChange: (state, detail) => {
          if (state === "ok") this.fallbackReported = false;
          options.onEvent?.({ event: state === "ok" ? "dns_relay_upstream_recovered" : "dns_relay_upstream_failing", message: detail });
        },
        onFallback: () => {
          // 障害の間、問い合わせのたびに記録しないよう、障害ごとに1回だけ記録する。
          if (this.fallbackReported) return;
          this.fallbackReported = true;
          options.onEvent?.({ event: "dns_relay_fallback" });
        },
      });
  }

  /**
   * 目的: 最新の設定を反映する。前回と同じ内容なら何もしない（APIは設定を10秒周期で再通知する）。
   *      待受に失敗している（state=error）間は、同じ内容でも再試行する。
   * 入力: settings(DNS中継の設定)。
   * 出力: 反映処理の完了を表すPromise（呼び出し元は待たなくてよい。状態はgetStatus()で得る）。
   */
  applySettings(settings: DnsRelaySettings): Promise<void> {
    const normalized: DnsRelaySettings = { ...settings, excludedDomains: sanitizeExcludedDomains(settings.excludedDomains) };
    const unchanged = this.hasApplied && this.state !== "error" && JSON.stringify(normalized) === JSON.stringify(this.settings);
    if (unchanged) return this.queue;
    this.hasApplied = true;
    this.settings = normalized;
    this.queue = this.queue.then(() => this.reconcile());
    return this.queue;
  }

  getStatus(): DnsRelayStatus {
    return {
      state: this.state,
      upstream: this.state === "active" ? this.relay.getUpstreamState() : "unknown",
      bypassEntries: this.options.bypassEntryCount(),
    };
  }

  private async reconcile(): Promise<void> {
    const settings = this.settings;
    if (!settings.enabled) {
      await this.stopListening();
      this.state = "stopped";
      return;
    }
    if (settings.upstreamUrl.length === 0 && settings.fallbackServers.length === 0) {
      await this.stopListening();
      this.state = "unconfigured";
      return;
    }
    this.relay.updateConfig(settings);
    if (this.listening) {
      this.state = "active";
      return;
    }
    try {
      await this.listener.start(this.options.listenAddresses, this.options.port, (query, clientIp) => this.relay.handle(query, clientIp));
      this.listening = true;
      this.state = "active";
      this.options.onEvent?.({ event: "dns_relay_started", port: this.options.port, addresses: this.options.listenAddresses });
    } catch (error) {
      this.state = "error";
      this.options.onEvent?.({ event: "dns_relay_config_error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async stopListening(): Promise<void> {
    if (!this.listening) return;
    await this.listener.stop();
    this.listening = false;
    this.options.onEvent?.({ event: "dns_relay_stopped" });
  }
}
