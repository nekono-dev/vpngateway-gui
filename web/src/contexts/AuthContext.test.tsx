// 責務: AuthContext（認証状態の判定・保持・ログアウト）のテスト。
// GET /v1/operator・GET /v1/operator/session・DELETE /v1/operator/sessionをモックする。

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getV1Operator: vi.fn(),
  getV1OperatorSession: vi.fn(),
  deleteV1OperatorSession: vi.fn(),
}));
vi.mock("../generated/api/default/default", () => api);

const { AuthProvider, useAuth } = await import("./AuthContext");

/** AuthContextの状態を画面へそのまま出す、テスト用の観測コンポーネント。 */
function Probe() {
  const { auth, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      {auth.status === "authenticated" ? <p data-testid="username">{auth.username}</p> : null}
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it("configured=falseなら status=setup になる", async () => {
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: false } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("setup"));
    expect(api.getV1OperatorSession).not.toHaveBeenCalled();
  });

  it("configured=trueでusername付き（有効なセッションCookieあり）なら status=authenticated になる", async () => {
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: true, username: "admin" } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("username")).toHaveTextContent("admin");
  });

  it("configured=trueでusername無し（未ログイン）なら status=login になる", async () => {
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: true } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("login"));
  });

  it("logoutを呼ぶとDELETE /v1/operator/sessionを呼び、status=loginへ戻る", async () => {
    api.getV1Operator.mockResolvedValue({ status: 200, data: { configured: true, username: "admin" } });
    api.deleteV1OperatorSession.mockResolvedValue({ status: 200, data: { authenticated: false } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    await userEvent.click(screen.getByRole("button", { name: "logout" }));

    expect(api.deleteV1OperatorSession).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("login"));
  });
});
