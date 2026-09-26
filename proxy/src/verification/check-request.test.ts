// 責務: 内部エンドポイントのリクエスト検証（check-request.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { parseCheckNonceRequest, parseGatewayCheckRequest } from "./check-request.js";

describe("parseGatewayCheckRequest", () => {
  it("既知の項目ID・httpsのURL・IPv4の値を受け付ける", () => {
    expect(
      parseGatewayCheckRequest({ check: "explicit-proxy-egress", echoUrl: "https://api.ipify.org", expectedEgressIp: "203.0.113.24" }),
    ).toEqual({ check: "explicit-proxy-egress", echoUrl: "https://api.ipify.org", expectedEgressIp: "203.0.113.24" });
  });

  it("未知の項目ID、httpsでないURL、認証情報付きのURL、IPv4でない値は拒否する", () => {
    expect(parseGatewayCheckRequest({ check: "client-egress", echoUrl: "https://api.ipify.org" })).toBeUndefined();
    expect(parseGatewayCheckRequest({ check: "tunnel-egress", echoUrl: "http://api.ipify.org" })).toBeUndefined();
    expect(parseGatewayCheckRequest({ check: "tunnel-egress", echoUrl: "https://u:p@api.ipify.org" })).toBeUndefined();
    expect(parseGatewayCheckRequest({ check: "tunnel-egress", echoUrl: "https://api.ipify.org", bypassProbeIp: "1.2.3.999" })).toBeUndefined();
    expect(parseGatewayCheckRequest(null)).toBeUndefined();
  });
});

describe("parseCheckNonceRequest", () => {
  it("検証名を小文字にして受け付け、形式が不正なら拒否する", () => {
    expect(parseCheckNonceRequest({ name: "VPNGW-k3f9x2ab.example.com", ttlSeconds: 60 })).toEqual({ name: "vpngw-k3f9x2ab.example.com", ttlSeconds: 60 });
    expect(parseCheckNonceRequest({ name: "example.com", ttlSeconds: 60 })).toBeUndefined();
    expect(parseCheckNonceRequest({ name: "vpngw-k3f9x2ab.example.com", ttlSeconds: "60" })).toBeUndefined();
  });
});
