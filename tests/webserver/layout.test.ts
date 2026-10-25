// 責務: 画面のスタイル（入力欄の文字サイズ）と、ホーム画面への追加に必要な資材（マニフェスト・アイコン・Service Worker）の受け入れテスト。
// 受け入れ条件 webserver/AC-21・AC-27 を、スタイルシートと配信する資材の内容で確認する（実ブラウザの表示は実ブラウザのテストで確認する）。

import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { readRepoFile, repoFileExists } from "../helpers/repo.js";

interface CssRule {
  selector: string;
  body: string;
}

/** 目的: スタイルシートから、ブロックを持つ規則（`@media` の中を含む）を取り出す。コメントは除く。 */
function parseRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: (match[1] ?? "").trim(), body: (match[2] ?? "").trim() });
  }
  return rules;
}

/** 目的: `font-size` の宣言値をピクセルへ換算する（`rem` は16、`px` はそのまま。それ以外は undefined）。 */
function fontSizePx(body: string): number | undefined {
  const match = /(?:^|;|\s)font-size:\s*([\d.]+)(rem|px)/.exec(body);
  if (match === null) return undefined;
  return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
}

describe("入力欄の文字サイズ", () => {
  it("webserver/AC-21: 全ての入力欄の文字サイズが16ピクセル以上に設定されている", () => {
    const rules = parseRules(readRepoFile("web/src/styles.css"));
    // 入力欄（文字入力・選択・複数行入力）を対象にする規則は、全て16ピクセル以上の文字サイズを持つか、文字サイズを変えない。
    const inputRules = rules.filter((rule) => /(^|[\s,>])(input|select|textarea)([\s,:.[]|$)/.test(rule.selector) && !/type="(checkbox|radio)"\]$/.test(rule.selector));
    const sizes = inputRules.map((rule) => ({ selector: rule.selector, size: fontSizePx(rule.body) })).filter((entry) => entry.size !== undefined);
    expect(sizes.length).toBeGreaterThan(0);
    for (const entry of sizes) expect(entry.size, entry.selector).toBeGreaterThanOrEqual(16);
    // 共通の規則が、文字入力・選択・複数行入力の全てに16ピクセル以上を与えている。
    const common = rules.find((rule) => rule.selector.includes("select,") && rule.selector.includes("textarea") && rule.selector.includes("input:not"));
    expect(common).toBeDefined();
    expect(fontSizePx(common?.body ?? "")).toBeGreaterThanOrEqual(16);
    // 枠線は専用の変数で、余白を持つ。
    expect(common?.body).toContain("var(--input-border)");
    expect(common?.body).toMatch(/padding:\s*8px 10px/);
  });
});

describe("ホーム画面への追加の資材", () => {
  it("webserver/AC-27: ホーム画面への追加に必要なマニフェスト・アイコン・Service Workerが配信され、画面から参照される", () => {
    const manifest = JSON.parse(readRepoFile("web/public/manifest.webmanifest")) as {
      display: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };
    expect(manifest.display).toBe("standalone");
    // マニフェストのアイコン3つ（通常192・512、マスカブル512）に加え、Apple用のアイコンがあり、全て実在する。
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    expect(manifest.icons.map((icon) => icon.purpose)).toContain("maskable");
    for (const icon of manifest.icons) expect(repoFileExists(`web/public${icon.src}`), icon.src).toBe(true);
    expect(repoFileExists("web/public/icons/apple-touch-icon.png")).toBe(true);
    expect(repoFileExists("web/public/sw.js")).toBe(true);
    // 画面の入口が、マニフェスト・アイコン・テーマ色を参照する。
    const html = readRepoFile("web/index.html");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('<meta name="theme-color"');
    // Service Workerは、対応する環境でだけ、画面の読み込み後に登録する。
    const main = readRepoFile("web/src/main.tsx");
    expect(main).toContain('"serviceWorker" in navigator');
    expect(main).toContain('addEventListener("load"');
    expect(main).toContain('register("/sw.js")');
  });

  it("webserver/AC-27: Service Workerは、APIの要求をキャッシュせず、静的な資材だけをキャッシュ優先で扱う", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const self = {
      addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
      location: { origin: "https://gateway.example" },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
    };
    runInNewContext(readRepoFile("web/public/sw.js"), { self, caches: { match: async () => undefined, open: async () => ({ put: async () => undefined }) }, fetch: async () => new Response("ok"), URL, Promise });
    const dispatch = (url: string, mode = "cors") => {
      const respondWith = vi.fn();
      handlers.get("fetch")?.({ request: { method: "GET", url, mode, clone: () => ({}) }, respondWith });
      return respondWith;
    };
    // APIの要求には介入せず、そのままネットワークへ向かう。
    expect(dispatch("https://gateway.example/api/v1/connection")).not.toHaveBeenCalled();
    // 静的な資材と画面遷移には応答する。
    expect(dispatch("https://gateway.example/assets/app.js")).toHaveBeenCalledTimes(1);
    expect(dispatch("https://gateway.example/", "navigate")).toHaveBeenCalledTimes(1);
    // 別のオリジンの要求には介入しない。
    expect(dispatch("https://other.example/assets/app.js")).not.toHaveBeenCalled();
  });
});
