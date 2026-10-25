// 責務: 設定ダイアログ（タブ・一括の保存・入力不備の警告）、行リストエディタ、ゲートウェイ再起動、アカウント変更の受け入れテスト。
// 受け入れ条件 webserver/AC-14・AC-15・AC-18・AC-19 を、APIクライアントをモックした実際の部品で確認する。

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiMocks, defaultConfig, installDashboardDefaults } from "./fixtures";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../../web/src/generated/api/default/default", async () => {
  const { createApiMocks: create } = await import("./fixtures");
  Object.assign(api, create(() => vi.fn()));
  return api;
});

const { SettingsDialog } = await import("../../web/src/components/dashboard/SettingsDialog");
const { LineListEditor } = await import("../../web/src/components/dashboard/LineListEditor");
const { RebootDialog } = await import("../../web/src/components/dashboard/RebootDialog");
const { AccountSettingsForm } = await import("../../web/src/components/dashboard/AccountSettingsForm");

const mocks = () => api as unknown as ReturnType<typeof createApiMocks>;

beforeEach(() => {
  installDashboardDefaults(mocks());
  api.putV1ConnectionConfig.mockResolvedValue({ status: 200, data: defaultConfig });
});

/** 目的: 行リストエディタ（見出しの名前で特定）へ1件追加し、入力して確定する（［追加］→入力→Enter）。 */
async function addListItem(name: RegExp, text: string): Promise<void> {
  const frame = screen.getByRole("listbox", { name }).closest(".line-list-frame") as HTMLElement;
  await userEvent.click(within(frame).getByRole("button", { name: /追加/ }));
  await userEvent.keyboard(`${text}{Enter}`);
}

describe("設定ダイアログ", () => {
  it("webserver/AC-14: 設定ダイアログは全タブの内容を一括で保存し、入力に不備のあるタブには警告印が付いて保存できない", async () => {
    render(<SettingsDialog open onClose={() => undefined} />);
    await screen.findByRole("tab", { name: "通信制御" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["通信制御", "ゲートウェイ", "上位DNSリゾルバ", "動作検証", "メンテナンス"]);

    // 通信制御タブで迂回ドメインを追加し、Kill Switchを無効にする。
    await addListItem(/迂回ドメイン/, "example.com");
    await userEvent.click(screen.getByRole("checkbox", { name: /Kill Switch/ }));

    // ゲートウェイタブで明示的プロキシを有効にすると、許可元が空のため保存できず、タブに警告印が付く。
    await userEvent.click(screen.getByRole("tab", { name: "ゲートウェイ" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /明示的プロキシモード/ }));
    expect(screen.getByRole("tab", { name: "ゲートウェイ !" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    // 別のタブを表示していても、保存は無効のままで、警告印が残る。
    await userEvent.click(screen.getByRole("tab", { name: "通信制御" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "ゲートウェイ !" })).toBeInTheDocument();

    // 許可元を入れると警告印が消え、保存できる。タブを切り替えても未保存の入力は失われない。
    await userEvent.click(screen.getByRole("tab", { name: "ゲートウェイ !" }));
    await addListItem(/明示的プロキシの許可CIDR/, "192.168.3.0/24");
    expect(screen.getByRole("tab", { name: "ゲートウェイ" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "通信制御" }));
    expect(within(screen.getByRole("listbox", { name: /迂回ドメイン/ })).getByDisplayValue("example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    // 全タブの内容が、1回の更新でまとめて送られる。
    await waitFor(() => expect(api.putV1ConnectionConfig).toHaveBeenCalledTimes(1));
    expect(api.putV1ConnectionConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        killSwitch: false,
        excludedDomains: ["example.com"],
        explicitProxyEnabled: true,
        explicitProxyAllowedCidrs: ["192.168.3.0/24"],
        transparentGatewayEnabled: true,
      }),
    );
  });

  it("webserver/AC-18: ゲートウェイ機の再起動はパスワードの再入力を求め、誤りをダイアログ内に示す", async () => {
    render(<RebootDialog open onClose={() => undefined} />);
    const reboot = screen.getByRole("button", { name: "再起動" });
    // 誤ったパスワードは、ダイアログ内に理由を示す。
    api.postV1GatewayReboot.mockResolvedValueOnce({ status: 401, data: { error: "unauthenticated" } });
    await userEvent.type(screen.getByLabelText(/パスワード/), "wrong-password");
    await userEvent.click(reboot);
    expect(api.postV1GatewayReboot).toHaveBeenCalledWith({ password: "wrong-password" });
    expect(await screen.findByRole("alert")).toHaveTextContent("パスワードが正しくありません");
    // 正しいパスワードは、受付と通信が止まる旨を示す。パスワード欄のラベルに「確認」「再入力」を含めない。
    api.postV1GatewayReboot.mockResolvedValueOnce({ status: 202, data: { requested: true } });
    await userEvent.clear(screen.getByLabelText(/パスワード/));
    await userEvent.type(screen.getByLabelText(/パスワード/), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "再起動" }));
    expect(await screen.findByRole("status")).toHaveTextContent("再起動を依頼しました");
    expect(screen.queryByLabelText(/確認|再入力/)).not.toBeInTheDocument();
  });

  it("webserver/AC-19: アカウント情報の変更は、現在のパスワードの入力を必須とする", async () => {
    api.putV1Operator.mockResolvedValue({ status: 200, data: { configured: true, username: "admin" } });
    render(<AccountSettingsForm />);
    // 現在のパスワードが空のままでは、送信できない（APIも呼ばれない）。
    await userEvent.type(screen.getByLabelText(/新しいパスワード/), "new-password-1");
    const submit = screen.getByRole("button", { name: "アカウントを変更" });
    await userEvent.click(submit);
    expect(api.putV1Operator).not.toHaveBeenCalled();
    // 現在のパスワードを入れると、現在と新しいパスワードがそろって送られる。
    await userEvent.type(screen.getByLabelText("現在のパスワード"), "correct-password");
    await userEvent.click(submit);
    expect(api.putV1Operator).toHaveBeenCalledWith({ currentPassword: "correct-password", newPassword: "new-password-1" });
    expect(await screen.findByRole("status")).toHaveTextContent("変更しました");
  });
});

/** 目的: 行リストエディタを、値を保持するテスト用の親で包む。 */
function Harness({ initial, maxItems }: { initial: string[]; maxItems?: number }) {
  const [value, setValue] = useState(initial);
  return <LineListEditor label="迂回ドメイン" value={value} maxItems={maxItems} onChange={setValue} />;
}

const texts = () => screen.queryAllByRole("option").map((option) => (within(option).getByRole("textbox") as HTMLInputElement).value);

describe("行リストエディタ", () => {
  it("webserver/AC-15: 行リストエディタは、選択行の直後への追加、複数選択の一括削除、上限に達した時点での追加の停止ができる", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["a", "b", "c", "d"]} maxItems={5} />);
    // 選択行の直後に追加する。
    await user.click(screen.getAllByRole("option")[1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: /追加/ }));
    await user.keyboard("x{Enter}");
    expect(texts()).toEqual(["a", "b", "x", "c", "d"]);
    // 上限（5件）に達したので、追加できない。
    expect(screen.getByRole("button", { name: /追加/ })).toBeDisabled();
    // Ctrl+クリックで複数選択し、まとめて削除する。
    await user.click(screen.getAllByRole("option")[0] as HTMLElement);
    await user.keyboard("{Control>}");
    await user.click(screen.getAllByRole("option")[3] as HTMLElement);
    await user.keyboard("{/Control}");
    await user.click(screen.getByRole("button", { name: /削除/ }));
    expect(texts()).toEqual(["b", "x", "d"]);
    // 件数が上限を下回ったので、追加できる。
    expect(screen.getByRole("button", { name: /追加/ })).toBeEnabled();
  });
});
