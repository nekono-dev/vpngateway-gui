// 責務: API と Web の WEB_HTTPS_ENABLED 判定規則が一致することを検証する。

import { describe, expect, it } from "vitest";
import { parseWebHttpsEnabled } from "./web-https-options.js";

const acceptedCases: Array<[NodeJS.ProcessEnv, boolean]> = [
  [{}, false],
  [{ WEB_HTTPS_ENABLED: "false" }, false],
  [{ WEB_HTTPS_ENABLED: "true" }, true],
];

const rejectedValues = ["TRUE", "1", "yes", "", " true"];

describe("WEB_HTTPS_ENABLED", () => {
  it.each(acceptedCases)("%j を %s と判定する", (env, expected) => {
    expect(parseWebHttpsEnabled(env)).toBe(expected);
  });

  it.each(rejectedValues)('不正値 "%s" を拒否する', (value) => {
    expect(() => parseWebHttpsEnabled({ WEB_HTTPS_ENABLED: value })).toThrow(/WEB_HTTPS_ENABLED/);
  });
});
