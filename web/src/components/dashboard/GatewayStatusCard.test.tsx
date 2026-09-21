// 責務: 透過ゲートウェイ稼働状況表示（各状態のラベル・色調、明示的プロキシの暫定表示）のコンポーネントテスト。

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GatewayStatus } from "../../hooks/useDashboardPolling";
import { GatewayStatusCard } from "./GatewayStatusCard";

function gatewayOf(transparentGateway: GatewayStatus["transparentGateway"]): GatewayStatus {
  return { transparentGateway };
}

describe("GatewayStatusCard", () => {
  it("稼働中（VPN接続中）はIF名とともに緑で表示する", () => {
    render(
      <GatewayStatusCard
        gateway={gatewayOf({ state: "active", vpnInterface: "tun0", killSwitchBlocking: false })}
        gatewayError={undefined}
        isLoading={false}
      />,
    );
    expect(screen.getByText("稼働中")).toHaveClass("badge-ok");
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
    expect(screen.getByText("Kill Switchにより遮断中（VPN未接続）")).toHaveClass("badge-warn");
    expect(screen.queryByText("稼働中")).not.toBeInTheDocument();
  });

  it.each([
    [{ state: "stopped", killSwitchBlocking: false }, "停止", "badge-muted"],
    [{ state: "unconfigured", killSwitchBlocking: false }, "未構成（LAN_IFACE未設定）", "badge-warn"],
    [{ state: "error", killSwitchBlocking: false }, "ルール適用エラー", "badge-danger"],
  ] as const)("%o は「%s」を表示する", (transparentGateway, label, tone) => {
    render(<GatewayStatusCard gateway={gatewayOf({ ...transparentGateway })} gatewayError={undefined} isLoading={false} />);
    expect(screen.getByText(label)).toHaveClass(tone);
  });

  it("取得失敗時は理由をalertで表示する", () => {
    render(<GatewayStatusCard gateway={undefined} gatewayError="稼働状況の取得に失敗しました (status: 502)" isLoading={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("status: 502");
  });

  it("取得中は取得中と表示する", () => {
    render(<GatewayStatusCard gateway={undefined} gatewayError={undefined} isLoading />);
    expect(screen.getByText("取得中...")).toBeInTheDocument();
  });

  it("明示的プロキシは常に「未対応」の暫定表示", () => {
    render(<GatewayStatusCard gateway={undefined} gatewayError={undefined} isLoading />);
    expect(screen.getByText(/未対応（Phase 4で対応予定）/)).toBeInTheDocument();
  });
});
