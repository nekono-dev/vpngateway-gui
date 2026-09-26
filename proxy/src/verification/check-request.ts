// 責務: 設定の動作検証の内部エンドポイント（`POST /net/checks`・`POST /net/check-nonces`）のリクエストボディの検証（純粋関数）。
// 形状はproxyserver/design.md「設定の動作検証」の「内部エンドポイント」に対応する。

import { GATEWAY_CHECK_IDS, type GatewayCheckId } from "./check-outcome.js";
import type { GatewayCheckRequest } from "./gateway-checks.js";
import { isValidCheckNonce } from "./check-nonces.js";

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = IPV4_PATTERN.exec(value);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/**
 * 目的: `POST /net/checks`のボディを検証する。
 * 入力: value(JSON.parse()の結果)。
 * 出力: 検証済みのリクエスト。項目IDが未知、URLがhttpsでない、IPがIPv4でない等はundefined。
 * 期待する入力形状: `{ "check": "<項目ID>", "echoUrl": "https://...", "expectedEgressIp"?: "a.b.c.d", "bypassProbeIp"?: "a.b.c.d" }`
 */
export function parseGatewayCheckRequest(value: unknown): GatewayCheckRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.check !== "string" || !(GATEWAY_CHECK_IDS as readonly string[]).includes(body.check)) return undefined;
  if (!isHttpsUrl(body.echoUrl)) return undefined;
  if (body.expectedEgressIp !== undefined && !isIpv4(body.expectedEgressIp)) return undefined;
  if (body.bypassProbeIp !== undefined && !isIpv4(body.bypassProbeIp)) return undefined;
  return {
    check: body.check as GatewayCheckId,
    echoUrl: body.echoUrl,
    ...(body.expectedEgressIp === undefined ? {} : { expectedEgressIp: body.expectedEgressIp }),
    ...(body.bypassProbeIp === undefined ? {} : { bypassProbeIp: body.bypassProbeIp }),
  };
}

/**
 * 目的: `POST /net/check-nonces`のボディを検証する。
 * 入力: value(JSON.parse()の結果)。
 * 出力: `{ name, ttlSeconds }`。形式が不正ならundefined。
 */
export function parseCheckNonceRequest(value: unknown): { name: string; ttlSeconds: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.name !== "string" || typeof body.ttlSeconds !== "number") return undefined;
  const name = body.name.toLowerCase();
  return isValidCheckNonce(name, body.ttlSeconds) ? { name, ttlSeconds: body.ttlSeconds } : undefined;
}
