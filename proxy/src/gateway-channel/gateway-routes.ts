// 責務: Gateway 制御要求の本番HTTPルートを依存注入可能なhandlerとして構成する。

import type { IncomingMessage, ServerResponse, RequestListener } from "node:http";
import { logAuditEvent as defaultAuditLogger } from "../lib/audit-event.js";
import { readRequestBody, sendJson } from "../lib/http-json.js";
import type { DnsRelayController } from "../dns-relay/dns-relay-controller.js";
import type { ExplicitProxyController } from "../explicit-proxy/explicit-proxy-controller.js";
import type { GatewayController } from "../network/gateway-controller.js";
import type { GatewayGuard } from "../network/gateway-guard.js";
import { parseSettingsRequest, toDnsRelaySettings, toGatewayDnsSettings } from "../settings-request.js";
import type { SettingsRequestQueue } from "../settings-request-queue.js";

export interface GatewayRequestHandlerDependencies {
  gatewayController: Pick<GatewayController, "applySettings" | "getStatus">;
  gatewayGuard: Pick<GatewayGuard, "applySettings" | "getStatus">;
  dnsRelayController: Pick<DnsRelayController, "applySettings" | "getStatus">;
  explicitProxyController: Pick<ExplicitProxyController, "applySettings" | "getStatus">;
  settingsRequestQueue: Pick<SettingsRequestQueue, "run">;
  lanAddress: string | undefined;
  lanCidr: string | undefined;
  dnsRelayPort: number;
  logAuditEvent?: (event: Record<string, unknown>) => void;
}

type FallbackHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** 設定・status の本番ルートと残りの既存ルートを束ねたHTTP handlerを生成する。 */
export function createGatewayRequestHandler(
  dependencies: GatewayRequestHandlerDependencies,
  fallback: FallbackHandler = (_req, res) => {
    sendJson(res, 404, { error: "not_found" });
  },
): RequestListener {
  const audit = dependencies.logAuditEvent ?? defaultAuditLogger;

  async function handleSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readRequestBody(req));
    } catch {
      if (res.destroyed) return;
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }

    const body = parseSettingsRequest(parsed);
    if (body === undefined) {
      sendJson(res, 400, { error: "invalid_request_shape" });
      return;
    }

    await dependencies.dnsRelayController.applySettings(toDnsRelaySettings(body));
    const relayActive = dependencies.dnsRelayController.getStatus().state === "active";
    let outcome: Awaited<ReturnType<GatewayController["applySettings"]>> | undefined;
    const guardApplied = await dependencies.gatewayGuard.applySettings({
      killSwitch: body.killSwitch,
      transparentGatewayEnabled: body.transparentGatewayEnabled,
    }, async () => {
      outcome = await dependencies.gatewayController.applySettings({
        killSwitch: body.killSwitch,
        transparentGatewayEnabled: body.transparentGatewayEnabled,
        dns: toGatewayDnsSettings(body, dependencies.lanAddress, dependencies.dnsRelayPort, relayActive),
      });
      return outcome.succeeded;
    });
    if (!guardApplied || outcome === undefined) {
      sendJson(res, 503, { error: "guard_apply_failed" });
      return;
    }

    dependencies.explicitProxyController.applySettings({
      enabled: body.explicitProxyEnabled,
      allowedCidrs: body.explicitProxyAllowedCidrs,
      nameServer: relayActive
        ? (dependencies.dnsRelayPort === 53 ? "127.0.0.1" : `127.0.0.1:${dependencies.dnsRelayPort}`)
        : undefined,
    });
    if (outcome.reconciled) {
      audit({
        event: "settings_applied",
        killSwitch: body.killSwitch,
        transparentGatewayEnabled: body.transparentGatewayEnabled,
        dnsRelayEnabled: body.dnsRelayEnabled,
        vpnIface: outcome.vpnIface,
        applied: outcome.applied,
      });
    }
    sendJson(res, 200, { succeeded: outcome.succeeded, applied: outcome.applied });
  }

  return (req, res) => {
    if (req.method === "GET" && req.url === "/net/status") {
      sendJson(res, 200, {
        transparentGateway: dependencies.gatewayController.getStatus(),
        gatewayGuard: dependencies.gatewayGuard.getStatus(),
        explicitProxy: dependencies.explicitProxyController.getStatus(),
        dnsRelay: dependencies.dnsRelayController.getStatus(),
        lanCidr: dependencies.lanCidr,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/net/settings") {
      dependencies.settingsRequestQueue.run(() => handleSettings(req, res)).catch((error: unknown) => {
        audit({ event: "settings_error", message: error instanceof Error ? error.message : String(error) });
        sendJson(res, 500, { error: "internal_error" });
      });
      return;
    }
    fallback(req, res);
  };
}
