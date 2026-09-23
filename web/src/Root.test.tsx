// 責務: Root（認証状態によるSetupPage/LoginPage/Appの出し分け）のテスト。

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ auth: { status: "loading" } as { status: string }, logout: vi.fn() }));
vi.mock("./contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("./components/auth/SetupPage", () => ({ SetupPage: () => <div>SetupPageStub</div> }));
vi.mock("./components/auth/LoginPage", () => ({ LoginPage: () => <div>LoginPageStub</div> }));
vi.mock("./App", () => ({ App: () => <div>AppStub</div> }));

const { Root } = await import("./Root");

describe("Root", () => {
  it("status=loadingでは何も表示しない", () => {
    auth.auth = { status: "loading" };
    const { container } = render(<Root />);
    expect(container).toBeEmptyDOMElement();
  });

  it("status=setupではSetupPageを表示する", () => {
    auth.auth = { status: "setup" };
    render(<Root />);
    expect(screen.getByText("SetupPageStub")).toBeInTheDocument();
  });

  it("status=loginではLoginPageを表示する", () => {
    auth.auth = { status: "login" };
    render(<Root />);
    expect(screen.getByText("LoginPageStub")).toBeInTheDocument();
  });

  it("status=authenticatedではAppを表示する", () => {
    auth.auth = { status: "authenticated", username: "admin" } as never;
    render(<Root />);
    expect(screen.getByText("AppStub")).toBeInTheDocument();
  });
});
