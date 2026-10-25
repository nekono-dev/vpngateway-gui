// 責務: 設定ダイアログの「動作検証」タブ（状態の表示・グループの折りたたみ・ブラウザ側の観測・進行の取得間隔）の受け入れテスト。
// 受け入れ条件 webserver/AC-16・AC-17・AC-26 を、APIクライアントとfetchを差し替えた実際の部品で確認する。

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiMocks, defaultConfig, installDashboardDefaults } from "./fixtures";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../../web/src/generated/api/default/default", async () => {
  const { createApiMocks: create } = await import("./fixtures");
  Object.assign(api, create(() => vi.fn()));
  return api;
});

const { SettingsDialog } = await import("../../web/src/components/dashboard/SettingsDialog");

const mocks = () => api as unknown as ReturnType<typeof createApiMocks>;
const VERIFICATION_ID = "11111111-1111-1111-1111-111111111111";

type Status = "pending" | "running" | "pass" | "fail" | "unconfirmed" | "notApplicable";

/** 目的: 検証の応答（グループごとに項目を持つ）を組み立てる。 */
function verification(state: "running" | "completed", statuses: Record<string, Status>, extra: Record<string, object> = {}) {
  const definitions: Array<[string, string, "config" | "gateway" | "client"]> = [
    ["gateway-rules", "透過ゲートウェイの構成", "config"],
    ["tunnel-egress", "VPN トンネルの出口 IP", "gateway"],
    ["bypass-routing", "迂回の経路", "gateway"],
    ["client-egress", "この端末の出口 IP", "client"],
  ];
  return {
    id: VERIFICATION_ID,
    state,
    startedAt: "2026-09-26T00:00:00.000Z",
    clientProbe: { dnsName: "vpngw-0123456789abcdef.example.com" },
    checks: definitions.map(([id, title, group]) => ({ id, title, group, status: statuses[id] ?? "pending", ...(extra[id] ?? {}) })),
  };
}

const fetchMock = vi.fn();

/** 目的: 設定ダイアログを開き、動作検証のタブを表示する。 */
async function openVerificationTab(): Promise<void> {
  render(<SettingsDialog open onClose={() => undefined} />);
  await userEvent.click(await screen.findByRole("tab", { name: "動作検証" }));
}

beforeEach(() => {
  installDashboardDefaults(mocks());
  api.getV1ConnectionConfig.mockResolvedValue({ status: 200, data: { ...defaultConfig, verifyEchoUrl: "https://echo.example" } });
  api.putV1VerificationsIdClientObservationsEgressIp.mockResolvedValue({ status: 200, data: { accepted: true } });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "https://echo.example") return new Response("198.51.100.7\n");
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("動作検証の表示", () => {
  it("webserver/AC-16: 動作検証の項目は状態ごとの表示で進み、グループは既定で閉じたまま不合格の件数を示す", async () => {
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({
      status: 200,
      data: verification("running", { "gateway-rules": "pass", "tunnel-egress": "fail", "bypass-routing": "running" }),
    });
    await openVerificationTab();
    // 実行前: 3つのグループが「未実行」を示す。
    for (const name of ["設定の確認", "ゲートウェイの通信確認", "この端末からの確認"]) {
      expect(within(screen.getByRole("region", { name })).getByText("未実行")).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));

    // 実行中: グループは自動で開かず、実行中の項目だけが見え、先に出た不合格は件数のバッジで分かる。
    const gateway = await screen.findByRole("region", { name: "ゲートウェイの通信確認" });
    await waitFor(() => expect(within(gateway).getByText("迂回の経路")).toBeInTheDocument());
    expect(within(gateway).getByText("確認中…")).toBeInTheDocument();
    expect(within(gateway).queryByText("VPN トンネルの出口 IP")).not.toBeInTheDocument();
    expect(within(gateway).getByText("NG 1")).toBeInTheDocument();
    expect(within(gateway).getByRole("button", { expanded: false })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "設定の確認" })).getByText("すべてOK（1/1）")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "この端末からの確認" })).getByText("待機中（1項目）")).toBeInTheDocument();
  });

  it("webserver/AC-16: 完了後は閉じたグループに最初の不合格の期待・観測・対処を示し、開くと全項目を表示する", async () => {
    const completed = verification(
      "completed",
      { "gateway-rules": "pass", "tunnel-egress": "pass", "bypass-routing": "fail", "client-egress": "unconfirmed" },
      {
        "tunnel-egress": { observed: "198.51.100.7（tun0 経由）" },
        "bypass-routing": { expected: "実回線へ送る", observed: "tun0 へ出る", hint: "設定を保存し直してください。" },
        "client-egress": { reason: "結果が届きませんでした。" },
      },
    );
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({ status: 200, data: completed });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));
    expect(await screen.findByRole("button", { name: "もう一度実行" })).toBeEnabled();
    expect(screen.getByText("NG 1件")).toBeInTheDocument();
    const gateway = screen.getByRole("region", { name: "ゲートウェイの通信確認" });
    expect(within(gateway).getByText("tun0 へ出る")).toBeInTheDocument();
    expect(within(gateway).getByText("設定を保存し直してください。")).toBeInTheDocument();
    expect(within(gateway).queryByText("VPN トンネルの出口 IP")).not.toBeInTheDocument();
    await userEvent.click(within(gateway).getByRole("button", { expanded: false }));
    expect(within(gateway).getByText("VPN トンネルの出口 IP")).toBeInTheDocument();
    expect(within(gateway).getByText("198.51.100.7（tun0 経由）")).toBeInTheDocument();
  });

  it("webserver/AC-17: 動作検証の開始直後に、ブラウザが出口IPを提出し、検証用の名前の解決を起こす", async () => {
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({ status: 200, data: verification("completed", {}) });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));
    // 利用者の操作なしで、出口IP（IPv4の本文）が提出される。
    await waitFor(() =>
      expect(api.putV1VerificationsIdClientObservationsEgressIp).toHaveBeenCalledWith(VERIFICATION_ID, { ip: "198.51.100.7" }),
    );
    // 検証用の名前は、名前解決だけを起こす（応答を使わない）。
    expect(fetchMock).toHaveBeenCalledWith("https://vpngw-0123456789abcdef.example.com/", expect.objectContaining({ mode: "no-cors", cache: "no-store" }));
  });

  it("webserver/AC-17: IP確認サービスに接続できないときは、出口IPなしで提出する", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({ status: 200, data: verification("completed", {}) });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));
    await waitFor(() => expect(api.putV1VerificationsIdClientObservationsEgressIp).toHaveBeenCalledWith(VERIFICATION_ID, { ip: null }));
  });
});

describe("動作検証の進行の取得", () => {
  it("webserver/AC-26: 動作検証の進行は、500ミリ秒ごとに取得される", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.postV1Verifications.mockResolvedValue({ status: 202, data: verification("running", {}) });
    api.getV1VerificationsId.mockResolvedValue({ status: 200, data: verification("running", { "gateway-rules": "running" }) });
    await openVerificationTab();
    await userEvent.click(screen.getByRole("button", { name: "検証を実行" }));
    await screen.findByRole("button", { name: /実行中/ });
    const calls = () => api.getV1VerificationsId.mock.calls.length;
    const before = calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(calls()).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(calls()).toBe(before + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calls()).toBe(before + 2);
  });
});
