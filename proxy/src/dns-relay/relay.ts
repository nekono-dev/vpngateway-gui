// 責務: DNS中継リゾルバの問い合わせ処理。①問い合わせ名を迂回リストと照合 → ②上流へ転送 →
// ③一致していれば応答のIPv4アドレスを迂回のsetへ登録 → ④応答を返す。上流の障害時は設定に従い
// フェイルクローズ（SERVFAIL）またはフォールバック。proxyserver/design.md「DNS中継リゾルバ」に対応する。

import { buildServfail, parseAnswer, parseQuery } from "./dns-message.js";
import { createDomainMatcher, type DomainMatcher } from "./domain-matcher.js";
import type { ClientIdResolver } from "./client-id.js";
import { forwardDoh, forwardPlain } from "./upstream.js";

export interface DnsRelayConfig {
  excludedDomains: readonly string[];
  upstreamUrl: string;
  upstreamCaPem: string;
  failureMode: "failClosed" | "fallback";
  fallbackServers: readonly string[];
}

export interface BypassAddress {
  address: string;
  ttl: number;
}

export interface RelayDependencies {
  clientIds: ClientIdResolver;
  // 迂回対象のIPv4アドレスの登録先。nftのsetへの反映が終わってから解決する（応答を返す前に待つ。応答を受け取った
  // クライアントが直ちに接続しても、最初のパケットから迂回されるようにするため）。
  registerBypass: (addresses: readonly BypassAddress[]) => Promise<void> | void;
  // 上流の疎通状態が変わったときの通知（監査ログ用）。
  onUpstreamStateChange: (state: "ok" | "failing", detail?: string) => void;
  onFallback: () => void;
  // テスト用フック（既定は実際の転送）。
  doh?: typeof forwardDoh;
  plain?: typeof forwardPlain;
}

export type UpstreamState = "unknown" | "ok" | "failing";

const EMPTY_CONFIG: DnsRelayConfig = {
  excludedDomains: [],
  upstreamUrl: "",
  upstreamCaPem: "",
  failureMode: "failClosed",
  fallbackServers: [],
};

export class DnsRelay {
  private config: DnsRelayConfig = EMPTY_CONFIG;
  private matcher: DomainMatcher = () => false;
  private upstreamState: UpstreamState = "unknown";

  constructor(private readonly deps: RelayDependencies) {}

  updateConfig(config: DnsRelayConfig): void {
    this.config = config;
    this.matcher = createDomainMatcher(config.excludedDomains);
  }

  getUpstreamState(): UpstreamState {
    return this.upstreamState;
  }

  /**
   * 目的: 1件の問い合わせを処理して応答を返す。
   * 入力: query(DNSクエリ), clientIp(問い合わせ元のIPv4アドレス)。
   * 出力: 応答メッセージ。形式が不正なクエリは応答しない（undefined）。
   * 副作用: 迂回対象のドメインに成功応答（NOERROR）が返った場合、そのAレコードを迂回のsetへ登録し、
   *        反映が終わってから応答を返す（登録の失敗は応答を妨げない）。
   */
  async handle(query: Buffer, clientIp: string): Promise<Buffer | undefined> {
    const question = parseQuery(query);
    if (question === undefined) return undefined;
    const clientId = this.deps.clientIds.resolve(clientIp);

    let response: Buffer;
    try {
      response = await this.forward(query, clientId);
    } catch {
      return buildServfail(query, question);
    }

    if (this.matcher(question.name)) {
      const answer = parseAnswer(response);
      if (answer !== undefined && answer.rcode === 0 && answer.aRecords.length > 0) {
        try {
          await this.deps.registerBypass(answer.aRecords);
        } catch {
          // 迂回の登録に失敗しても名前解決自体は返す（失敗はGatewayController側が監査ログへ記録する）。
        }
      }
    }
    return response;
  }

  private async forward(query: Buffer, clientId: string): Promise<Buffer> {
    const doh = this.deps.doh ?? forwardDoh;
    const plain = this.deps.plain ?? forwardPlain;
    const { upstreamUrl, upstreamCaPem, failureMode, fallbackServers } = this.config;

    if (upstreamUrl.length === 0) {
      // 上流が未設定なら、フォールバック先を通常の上流として使う（ClientIDは付けられない）。
      return plain(fallbackServers, query);
    }
    try {
      const response = await doh(upstreamUrl, upstreamCaPem, query, clientId);
      this.setUpstreamState("ok");
      return response;
    } catch (error) {
      this.setUpstreamState("failing", error instanceof Error ? error.message : String(error));
      if (failureMode === "fallback" && fallbackServers.length > 0) {
        this.deps.onFallback();
        return plain(fallbackServers, query);
      }
      throw error;
    }
  }

  private setUpstreamState(state: "ok" | "failing", detail?: string): void {
    if (this.upstreamState === state) return;
    this.upstreamState = state;
    this.deps.onUpstreamStateChange(state, detail);
  }
}
