// 責務: ThemeProvider（テーマの取得・保存・OS 配色への追従・取得完了までの描画の待ち合わせ）の単体テスト。

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  getV1UiPreferences: vi.fn(),
  putV1UiPreferences: vi.fn(),
}));
vi.mock("../generated/api/default/default", () => api);

const toast = vi.hoisted(() => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("../notifications/ToastProvider", () => ({ useToast: () => toast }));

const { ThemeProvider, useTheme } = await import("./ThemeContext");

// OS の配色設定を模擬する（jsdom には matchMedia が無いため、テスト内で置き換える）。
let prefersDark = false;
let mediaListeners = new Set<(event: { matches: boolean }) => void>();

function stubMatchMedia(initialDark: boolean) {
  prefersDark = initialDark;
  mediaListeners = new Set();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" ? prefersDark : false;
    },
    media: query,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => mediaListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
}

/** OS の配色が変わったことを通知する。 */
function changeOsScheme(dark: boolean) {
  prefersDark = dark;
  act(() => {
    mediaListeners.forEach((listener) => listener({ matches: dark }));
  });
}

/** 描画された時点の data-theme を記録する子要素（取得完了後に描画されることと、属性の設定順を確かめる）。 */
const renderedThemes: (string | undefined)[] = [];
function Probe() {
  renderedThemes.push(document.documentElement.dataset.theme);
  const { resolved } = useTheme();
  return <div>child-{resolved}</div>;
}

function renderWithTheme(children: ReactNode = <Probe />) {
  return render(<ThemeProvider>{children}</ThemeProvider>);
}

beforeEach(() => {
  api.getV1UiPreferences.mockReset();
  api.putV1UiPreferences.mockReset();
  toast.notifyError.mockReset();
  renderedThemes.length = 0;
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = '<meta name="theme-color" content="#0969da" />';
  stubMatchMedia(false);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = "";
});

describe("ThemeProvider: 起動時の取得と描画の待ち合わせ（タスク 5.1）", () => {
  it("取得が終わるまで子要素を描画せず、空白にする（4.1）", () => {
    api.getV1UiPreferences.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithTheme();
    expect(container).toBeEmptyDOMElement();
    expect(renderedThemes).toEqual([]);
  });

  it("保存済みのテーマを適用してから子要素を描画する（4.2・4.3）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 200, data: { theme: "dark" } });
    renderWithTheme();
    expect(await screen.findByText("child-dark")).toBeInTheDocument();
    // 子要素が最初に描画された時点で、既に dark が適用されている（ライトからの切り替わりを見せない）。
    expect(renderedThemes[0]).toBe("dark");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#0d1117");
  });

  it("取得が失敗したら OS 規定として描画を続ける（3.4）", async () => {
    api.getV1UiPreferences.mockRejectedValue(new Error("network down"));
    stubMatchMedia(true);
    renderWithTheme();
    expect(await screen.findByText("child-dark")).toBeInTheDocument();
    expect(toast.notifyError).not.toHaveBeenCalled();
  });

  it("応答の形が不正（3種類以外・ステータス異常）なら OS 規定として描画を続ける（3.4）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 500, data: { error: "internal_error" } });
    renderWithTheme();
    expect(await screen.findByText("child-light")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("保存値がライトなら、OS がダークでもライトで表示する（OS 規定以外は OS に従わない）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 200, data: { theme: "light" } });
    stubMatchMedia(true);
    renderWithTheme();
    expect(await screen.findByText("child-light")).toBeInTheDocument();
  });

  it("OS 規定で OS の配色が変わると、再読み込みなしで表示が変わる（1.3・1.4）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 200, data: { theme: "system" } });
    renderWithTheme();
    expect(await screen.findByText("child-light")).toBeInTheDocument();
    changeOsScheme(true);
    expect(await screen.findByText("child-dark")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

/** 切り替えを押す子要素（保存の挙動を確かめる）。現在の選択も表示する。 */
function Switcher({ next }: { next: "system" | "light" | "dark" }) {
  const { preference, setPreference } = useTheme();
  return (
    <>
      <p>pref-{preference}</p>
      <button type="button" onClick={() => void setPreference(next)}>
        switch-{next}
      </button>
    </>
  );
}

describe("ThemeProvider: 切り替えの保存と差し戻し（タスク 5.2）", () => {
  it("切り替えは即時に画面へ反映し、その後に保存する（1.2・2.1）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 200, data: { theme: "system" } });
    let resolveSave: (value: unknown) => void = () => {};
    api.putV1UiPreferences.mockReturnValue(new Promise((resolve) => (resolveSave = resolve)));
    renderWithTheme(<Switcher next="dark" />);
    await screen.findByText("pref-system");

    screen.getByRole("button", { name: "switch-dark" }).click();

    // 保存の応答を待たずに、画面はダークへ切り替わっている。
    expect(await screen.findByText("pref-dark")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(api.putV1UiPreferences).toHaveBeenCalledWith({ theme: "dark" });
    await act(async () => resolveSave({ status: 200, data: { theme: "dark" } }));
    expect(toast.notifyError).not.toHaveBeenCalled();
  });

  it("保存に失敗したら切り替え前のテーマへ戻し、通知を出す（2.3）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 200, data: { theme: "light" } });
    api.putV1UiPreferences.mockResolvedValue({ status: 500, data: { error: "internal_error" } });
    renderWithTheme(<Switcher next="dark" />);
    await screen.findByText("pref-light");

    screen.getByRole("button", { name: "switch-dark" }).click();

    await vi.waitFor(() => expect(toast.notifyError).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("pref-light")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(toast.notifyError.mock.calls[0][0].summary).toContain("テーマの保存に失敗しました");
  });

  it("通信の例外でも切り替え前へ戻し、通知を出す（2.3）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 200, data: { theme: "light" } });
    api.putV1UiPreferences.mockRejectedValue(new Error("connection reset"));
    renderWithTheme(<Switcher next="dark" />);
    await screen.findByText("pref-light");

    screen.getByRole("button", { name: "switch-dark" }).click();

    await vi.waitFor(() => expect(toast.notifyError).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("pref-light")).toBeInTheDocument();
  });

  it("保存中は別の切り替えを受け付けない（連続の保存を防ぐ）", async () => {
    api.getV1UiPreferences.mockResolvedValue({ status: 200, data: { theme: "system" } });
    api.putV1UiPreferences.mockReturnValue(new Promise(() => {}));
    renderWithTheme(
      <>
        <Switcher next="dark" />
        <Switcher next="light" />
      </>,
    );
    await screen.findAllByText("pref-system");

    screen.getAllByRole("button", { name: "switch-dark" })[0].click();
    screen.getAllByRole("button", { name: "switch-light" })[0].click();

    expect(api.putV1UiPreferences).toHaveBeenCalledTimes(1);
    expect(api.putV1UiPreferences).toHaveBeenCalledWith({ theme: "dark" });
  });
});
