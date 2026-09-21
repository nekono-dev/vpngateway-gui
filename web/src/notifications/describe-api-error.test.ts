// 責務: APIエラーレスポンス→トースト表示内容（要約/詳細）変換の単体テスト。

import { describe, expect, it } from "vitest";
import { describeApiError, describeThrownError } from "./describe-api-error";

describe("describeApiError", () => {
  it("422は要約にexit codeを含め、stderrは詳細側にのみ入れる", () => {
    const result = describeApiError(
      422,
      { error: "command_failed", exitCode: 3, stderr: "Error: not logged in" },
      "接続に失敗しました",
    );
    expect(result.summary).toBe("接続に失敗しました（VPNコマンドが異常終了: exit code 3）");
    expect(result.summary).not.toContain("not logged in");
    expect(result.detail).toBe("Error: not logged in");
  });

  it("502/504はプロキシ障害である旨を要約に示す", () => {
    expect(describeApiError(502, { error: "proxy_unavailable", message: "failed to connect" }, "切断に失敗しました")).toEqual({
      summary: "切断に失敗しました（プロキシサーバに接続できません）",
      detail: "failed to connect",
    });
    expect(describeApiError(504, { error: "proxy_timeout" }, "切断に失敗しました").summary).toBe(
      "切断に失敗しました（プロキシサーバの応答がタイムアウトしました）",
    );
  });

  it("stderrが空白のみならmessageを詳細に使う", () => {
    expect(describeApiError(422, { exitCode: 1, stderr: "  \n", message: "status command failed" }, "x").detail).toBe(
      "status command failed",
    );
  });

  it("本文がオブジェクトでない（HTML等）場合もfallbackとステータスで組み立てる", () => {
    expect(describeApiError(500, "<html>", "設定の保存に失敗しました")).toEqual({
      summary: "設定の保存に失敗しました (status: 500)",
      detail: undefined,
    });
  });

  it("403（プラン制限）は、通常の実行失敗と区別してプランが原因であることを示す", () => {
    const content = describeApiError(403, { error: "operation_restricted", message: "現在のプランでは利用できない操作です", exitCode: 2, stderr: "not available on the free plan" }, "接続に失敗しました");
    expect(content.summary).toBe("接続に失敗しました（現在のプランでは利用できない操作です）");
    expect(content.detail).toBe("not available on the free plan");
  });

  it("501（プロバイダ非対応）は、非対応であることを示す", () => {
    expect(describeApiError(501, { error: "operation_unsupported" }, "ログアウトに失敗しました").summary).toBe(
      "ログアウトに失敗しました（このVPNプロバイダでは利用できない操作です）",
    );
  });
});

describe("describeThrownError", () => {
  it("fetch失敗はAPIサーバへ接続できない旨を要約に、例外メッセージを詳細に入れる", () => {
    expect(describeThrownError(new TypeError("Failed to fetch"), "接続に失敗しました")).toEqual({
      summary: "接続に失敗しました（APIサーバに接続できません）",
      detail: "Failed to fetch",
    });
  });
});
