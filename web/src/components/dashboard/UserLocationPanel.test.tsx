// 責務: 設定の「利用者の場所」パネル（現在の国の表示・国の選択・保存・既定へ戻す・ブラウザ由来の注記）のテスト。

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getV1UserLocation: vi.fn(),
  putV1UserLocation: vi.fn(),
  deleteV1UserLocation: vi.fn(),
}));
vi.mock("../../generated/api/default/default", () => api);

import { UserLocationPanel } from "./UserLocationPanel";

const COUNTRIES = [
  { code: "JP", name: "日本" },
  { code: "US", name: "アメリカ合衆国" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserLocationPanel", () => {
  it("保存が無ければ、ブラウザ由来の国を表示し、既定値の注記を出す", async () => {
    api.getV1UserLocation.mockResolvedValue({
      status: 200,
      data: { source: "browser", effective: "JP", countries: COUNTRIES },
    });
    render(<UserLocationPanel />);
    expect(await screen.findByText(/^現在の場所:\s*日本$/)).toBeInTheDocument();
    expect(screen.getByText("既定値はブラウザの言語設定から推定したもので、現在の場所と異なる場合があります")).toBeInTheDocument();
  });

  it("保存された国は注記を出さず、既定へ戻すを押すと削除を送る", async () => {
    api.getV1UserLocation.mockResolvedValue({
      status: 200,
      data: { saved: "US", source: "saved", effective: "US", countries: COUNTRIES },
    });
    api.deleteV1UserLocation.mockResolvedValue({ status: 200, data: { source: "browser", effective: "JP", countries: COUNTRIES } });
    render(<UserLocationPanel />);
    await screen.findByText(/^現在の場所:\s*アメリカ合衆国$/);
    expect(screen.queryByText(/既定値はブラウザの言語設定/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "既定値に戻す" }));
    await waitFor(() => expect(api.deleteV1UserLocation).toHaveBeenCalledTimes(1));
  });

  it("国を選んで保存すると、その国コードを送る", async () => {
    api.getV1UserLocation.mockResolvedValue({ status: 200, data: { source: "none", countries: COUNTRIES } });
    api.putV1UserLocation.mockResolvedValue({ status: 200, data: { saved: "US", source: "saved", effective: "US", countries: COUNTRIES } });
    render(<UserLocationPanel />);
    await screen.findByRole("combobox", { name: "利用者の国" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "利用者の国" }), "US");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.putV1UserLocation).toHaveBeenCalledWith({ country: "US" }));
  });

  it("取得に失敗したら、エラーを表示する", async () => {
    api.getV1UserLocation.mockResolvedValue({ status: 401, data: { error: "unauthenticated" } });
    render(<UserLocationPanel />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
