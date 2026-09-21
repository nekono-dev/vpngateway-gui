// 責務: 稼働状況表示（透過ゲートウェイ・明示的プロキシの各状態のラベル・色調・取得失敗/取得中）のコンポーネントテスト。

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GatewayStatus } from "../../hooks/useDashboardPolling";
import { GatewayStatusCard } from "./GatewayStatusCard";

const STOPPED_EXPLICIT_PROXY: GatewayStatus["explicitProxy"] = { state: "stopped", restartCount: 0 };

function gatewayOf(
  transparentGateway: GatewayStatus["transparentGateway"],
  explicitProxy: GatewayStatus["explicitProxy"] = STOPPED_EXPLICIT_PROXY,
): GatewayStatus {
  return { transparentGateway, explicitProxy };
}

// 両行に「稼働中」「停止」等が現れうるため、機能ごとの行（dd）に絞って検証する。
function transparentGatewayRow(): HTMLElement {
  return screen.getByTestId("status-transparent-gateway");
}
function explicitProxyRow(): HTMLElement {
  return screen.getByTestId("status-explicit-proxy");
}

describe("GatewayStatusCard 透過ゲートウェイ", () => {
  it("稼働中（VPN接続中）はIF名とともに緑で表示する", () => {
    render(
      <GatewayStatusCard
        gateway={gatewayOf({ state: "active", vpnInterface: "tun0", killSwitchBlocking: false })}
        gatewayError={undefined}
        isLoading={false}
      />,
    );
    expect(within(transparentGatewayRow()).getByText("稼働中")).toHaveClass("badge-ok");
    expect(screen.getByText(/VPN IF: tun0/)).toBeInTheDocument();
  });

  it("Kill Switch遮断中は稼働中より優先して警告色で表示する", () => {
    render(
      <GatewayStatusCard
        gateway={gatewayOf({ state: "active", killSwitchBlocking: true })}
        gatewayError={undefined}
        isLoading={false}
      />,
    );
    expect(within(transparentGatewayRow()).getByText("Kill Switchにより遮断中（VPN未接続）")).toHaveClass("badge-warn");
    expect(within(transparentGatewayRow()).queryByText("稼働中")).not.toBeInTheDocument();
  });

  it.each([
    [{ state: "stopped", killSwitchBlocking: false }, "停止", "badge-muted"],
    [{ state: "unconfigured", killSwitchBlocking: false }, "未構成（LAN_IFACE未設定）", "badge-warn"],
    [{ state: "error", killSwitchBlocking: false }, "ルール適用エラー", "badge-danger"],
  ] as const)("%o は「%s」を表示する", (transparentGateway, label, tone) => {
    render(<GatewayStatusCard gateway={gatewayOf({ ...transparentGateway })} gatewayError={undefined} isLoading={false} />);
    expect(within(transparentGatewayRow()).getByText(label)).toHaveClass(tone);
  });
});

describe("GatewayStatusCard 明示的プロキシ", () => {
  const transparentGateway: GatewayStatus["transparentGateway"] = { state: "stopped", killSwitchBlocking: false };

  it("稼働中は待ち受けポートとともに緑で表示する", () => {
    render(
      <GatewayStatusCard
        gateway={gatewayOf(transparentGateway, { state: "active", socksPort: 1080, httpPort: 3128, restartCount: 0 })}
        gatewayError={undefined}
        isLoading={false}
      />,
    );
    expect(within(explicitProxyRow()).getByText("稼働中")).toHaveClass("badge-ok");
    expect(within(explicitProxyRow()).getByText(/SOCKS5 :1080 \/ HTTP :3128/)).toBeInTheDocument();
  });

  it.each([
    [{ state: "stopped", restartCount: 0 }, "停止", "badge-muted"],
    [{ state: "unconfigured", restartCount: 0 }, "未構成（許可CIDRが空）", "badge-warn"],
    [{ state: "crashLoop", restartCount: 5 }, "起動失敗を繰り返しています（再起動5回）", "badge-danger"],
    [{ state: "error", restartCount: 0 }, "設定ファイルの生成エラー", "badge-danger"],
  ] as const)("%o は「%s」を表示する", (explicitProxy, label, tone) => {
    render(
      <GatewayStatusCard
        gateway={gatewayOf(transparentGateway, { ...explicitProxy })}
        gatewayError={undefined}
        isLoading={false}
      />,
    );
    expect(within(explicitProxyRow()).getByText(label)).toHaveClass(tone);
    // 稼働中以外はポートを表示しない（待ち受けていないため）。
    expect(within(explicitProxyRow()).queryByText(/SOCKS5/)).not.toBeInTheDocument();
  });
});

describe("GatewayStatusCard 取得失敗・取得中", () => {
  it("取得失敗時は1行目に理由をalertで表示し、2行目は取得失敗とだけ表示する（alertの重複を避ける）", () => {
    render(<GatewayStatusCard gateway={undefined} gatewayError="稼働状況の取得に失敗しました (status: 502)" isLoading={false} />);
    expect(within(transparentGatewayRow()).getByRole("alert")).toHaveTextContent("status: 502");
    expect(within(explicitProxyRow()).getByText("取得失敗")).toHaveClass("badge-danger");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("取得中は両方の行に取得中と表示する", () => {
    render(<GatewayStatusCard gateway={undefined} gatewayError={undefined} isLoading />);
    expect(within(transparentGatewayRow()).getByText("取得中...")).toBeInTheDocument();
    expect(within(explicitProxyRow()).getByText("取得中...")).toBeInTheDocument();
  });
});
