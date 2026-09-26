// 責務: 設定の動作検証が使う実行環境（nft・ip・curl・中継リゾルバ・TCP接続）の実体を用意する。
// 判定のロジック（gateway-checks.ts）から、実行環境への依存を分離するための組み立て処理。

import { connect } from "node:net";
import { runNftCommand } from "../network/nft-client.js";
import { GATEWAY_TABLE_NAME } from "../network/ruleset.js";
import { getRouteInterface } from "../network/tunnel-interface.js";
import { isIpForwardEnabled } from "../network/ip-forward.js";
import type { GatewayController } from "../network/gateway-controller.js";
import type { DnsRelayController } from "../dns-relay/dns-relay-controller.js";
import type { ExplicitProxyController } from "../explicit-proxy/explicit-proxy-controller.js";
import type { GatewayCheckDependencies } from "./gateway-checks.js";
import { parseSetElements, parseTableListing, type SetElement } from "./nft-listing.js";
import { fetchEgressIp } from "./egress-probe.js";
import { queryRelay } from "./relay-probe.js";

const TCP_CONNECT_TIMEOUT_MS = 2000;

/** 目的: `inet vpngwgui`のsetの要素を読む。setが無い（テーブルが無い等）ならundefined。 */
export async function readSetElements(setName: string): Promise<SetElement[] | undefined> {
  const result = await runNftCommand(["-j", "list", "set", "inet", GATEWAY_TABLE_NAME, setName]);
  return result.exitCode === 0 ? parseSetElements(result.stdout) : undefined;
}

async function readTable(): Promise<Map<string, string[]> | undefined> {
  const result = await runNftCommand(["list", "table", "inet", GATEWAY_TABLE_NAME]);
  return result.exitCode === 0 ? parseTableListing(result.stdout) : undefined;
}

function tcpReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(TCP_CONNECT_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export interface VerificationRuntimeInput {
  gatewayController: GatewayController;
  dnsRelayController: DnsRelayController;
  explicitProxyController: ExplicitProxyController;
  dnsRelayPort: number;
  dnsRelayListenAddresses: readonly string[];
  lanAddress: string | undefined;
}

/** 目的: 実際のコントローラ・コマンドを使う実行環境を組み立てる。 */
export function createVerificationRuntime(input: VerificationRuntimeInput): GatewayCheckDependencies {
  return {
    gatewayState: () => input.gatewayController.getVerificationState(),
    relay: () => ({
      status: input.dnsRelayController.getStatus(),
      settings: input.dnsRelayController.getSettings(),
      port: input.dnsRelayPort,
      listenAddresses: input.dnsRelayListenAddresses,
    }),
    explicitProxy: () => ({
      status: input.explicitProxyController.getStatus(),
      allowedCidrs: input.explicitProxyController.getAllowedCidrs(),
    }),
    lanAddress: input.lanAddress,
    listTable: readTable,
    listSet: readSetElements,
    ipForwardEnabled: isIpForwardEnabled,
    routeInterface: getRouteInterface,
    fetchEgress: fetchEgressIp,
    queryRelay,
    tcpReachable,
  };
}
