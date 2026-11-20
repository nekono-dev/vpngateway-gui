import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getV1ConnectionCityTab, putV1ConnectionCityTab } from "../generated/api/default/default";
import { useCityTab } from "./useCityTab";

vi.mock("../generated/api/default/default", () => ({ getV1ConnectionCityTab: vi.fn(), putV1ConnectionCityTab: vi.fn() }));

it("都市タブを取得し、変更を保存する", async () => {
  vi.mocked(getV1ConnectionCityTab).mockResolvedValue({ data: { tab: "select" }, status: 200, headers: new Headers() });
  vi.mocked(putV1ConnectionCityTab).mockResolvedValue({ data: { tab: "fastest" }, status: 200, headers: new Headers() });
  const { result } = renderHook(() => useCityTab());
  await waitFor(() => expect(result.current.tab).toBe("select"));
  await act(async () => result.current.save("fastest"));
  expect(putV1ConnectionCityTab).toHaveBeenCalledWith({ tab: "fastest" });
});

it("都市タブの取得失敗をエラー状態として返す", async () => {
  vi.mocked(getV1ConnectionCityTab).mockRejectedValue(new Error("network unavailable"));
  const { result } = renderHook(() => useCityTab());
  await waitFor(() => expect(result.current.error).toBeDefined());
  expect(result.current.error?.summary).toContain("取得に失敗");
  expect(result.current.isLoading).toBe(false);
});
