// 責務: Compose の argv と ps JSON 出力を結果分類用に解析できることを検証する。

import { describe, expect, it } from "vitest";
import { composePsArgs, parseComposePs } from "./docker-compose-result.js";

describe("Compose 結果解析", () => {
  it("固定 project を含む ps -a JSON 用 argv を作る", () => {
    expect(composePsArgs(["compose", "-p", "vpngwgui", "-f", "docker-compose.yml"])).toEqual([
      "compose", "-p", "vpngwgui", "-f", "docker-compose.yml", "ps", "-a", "--format", "json",
    ]);
  });

  it("JSON 配列と NDJSON の API service state/exit code を読む", () => {
    expect(parseComposePs('[{"Service":"api","State":"exited","ExitCode":1}]')).toEqual([
      { service: "api", state: "exited", exitCode: 1 },
    ]);
    expect(parseComposePs('{"Service":"api","State":"running","ExitCode":0}\n{"Service":"web","State":"running","ExitCode":0}')).toEqual([
      { service: "api", state: "running", exitCode: 0 },
      { service: "web", state: "running", exitCode: 0 },
    ]);
  });

  it("不正な JSON と不完全な state は無視せずエラーにする", () => {
    expect(() => parseComposePs("not json")).toThrow("Compose ps JSON");
    expect(() => parseComposePs('[{"Service":"api"}]')).toThrow("Compose ps entry");
  });
});
