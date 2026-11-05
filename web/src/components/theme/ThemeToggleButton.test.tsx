// 責務: ThemeToggleButton（テーマの切り替えボタン）の表示・循環・保存中の無効化の単体テスト。

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({
  value: { preference: "system", resolved: "light", saving: false, setPreference: vi.fn() } as {
    preference: string;
    resolved: string;
    saving: boolean;
    setPreference: (next: string) => Promise<void>;
  },
}));
vi.mock("../../contexts/ThemeContext", () => ({ useTheme: () => theme.value }));

const { ThemeToggleButton } = await import("./ThemeToggleButton");
const { THEME_LABEL } = await import("../../theme/theme-preference");

beforeEach(() => {
  theme.value = { preference: "system", resolved: "light", saving: false, setPreference: vi.fn() };
});

describe("ThemeToggleButton", () => {
  it("現在の選択を「テーマ: 表示名」として示す", () => {
    theme.value.preference = "dark";
    render(<ThemeToggleButton />);
    expect(screen.getByRole("button", { name: "テーマ: ダーク" })).toBeInTheDocument();
  });

  it("押すと次のテーマへ循環する（OS 規定 → ライト → ダーク → OS 規定）（1.1）", async () => {
    const user = userEvent.setup();
    theme.value.preference = "system";
    render(<ThemeToggleButton />);
    await user.click(screen.getByRole("button"));
    expect(theme.value.setPreference).toHaveBeenLastCalledWith("light");
  });

  it("ダークの次は OS 規定に戻る", async () => {
    const user = userEvent.setup();
    theme.value.preference = "dark";
    render(<ThemeToggleButton />);
    await user.click(screen.getByRole("button"));
    expect(theme.value.setPreference).toHaveBeenLastCalledWith("system");
  });

  it("文字を出さず、テーマに対応するアイコンだけを表示する", () => {
    for (const [preference, icon] of [["system", "system"], ["light", "light"], ["dark", "dark"]] as const) {
      theme.value.preference = preference;
      const { container, unmount } = render(<ThemeToggleButton />);
      const button = screen.getByRole("button");
      expect(button.textContent).toBe("");
      expect(button).toHaveAttribute("title", `テーマ: ${THEME_LABEL[preference]}`);
      expect(container.querySelector("svg")).toHaveAttribute("data-icon", icon);
      unmount();
    }
  });

  it("保存中は押せない", () => {
    theme.value.saving = true;
    render(<ThemeToggleButton />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
