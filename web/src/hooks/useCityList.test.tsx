import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getV1ConnectionLocationsCountryCities, postV1ConnectionLocationsCountryCitiesRefresh } from "../generated/api/default/default";
import { useCityList } from "./useCityList";

vi.mock("../generated/api/default/default", () => ({
  getV1ConnectionLocationsCountryCities: vi.fn(),
  postV1ConnectionLocationsCountryCitiesRefresh: vi.fn(),
}));

const cities = [{ id: "city-1", country: "us", countryName: "United States", city: "New York", favorite: false, lastConnected: false }];

describe("useCityList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("都市一覧を取得する", async () => {
    vi.mocked(getV1ConnectionLocationsCountryCities).mockResolvedValue({ data: cities, status: 200, headers: new Headers() });
    const { result } = renderHook(() => useCityList("us"));
    await waitFor(() => expect(result.current.cities).toEqual(cities));
    expect(result.current.error).toBeUndefined();
  });

  it("取得失敗を表示でき、再取得で読み直す", async () => {
    vi.mocked(getV1ConnectionLocationsCountryCities).mockResolvedValueOnce({ data: { error: "failed" }, status: 502, headers: new Headers() } as never);
    vi.mocked(postV1ConnectionLocationsCountryCitiesRefresh).mockResolvedValue({ data: cities, status: 200, headers: new Headers() });
    const { result } = renderHook(() => useCityList("us"));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.summary).toContain("取得に失敗");
    await act(async () => result.current.refresh());
    expect(postV1ConnectionLocationsCountryCitiesRefresh).toHaveBeenCalledWith("us");
    expect(result.current.cities).toEqual(cities);
    expect(result.current.error).toBeUndefined();
  });

  it("国を切り替えた後に届いた古い応答を無視する", async () => {
    let resolveA!: (value: Awaited<ReturnType<typeof getV1ConnectionLocationsCountryCities>>) => void;
    vi.mocked(getV1ConnectionLocationsCountryCities)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockResolvedValueOnce({ data: [{ ...cities[0], id: "city-b", country: "gb", city: "London" }], status: 200, headers: new Headers() });
    const { result, rerender } = renderHook(({ country }) => useCityList(country), { initialProps: { country: "us" } });
    rerender({ country: "gb" });
    await waitFor(() => expect(result.current.cities[0]?.id).toBe("city-b"));
    await act(async () => {
      resolveA({ data: cities, status: 200, headers: new Headers() });
    });
    expect(result.current.cities[0]?.id).toBe("city-b");
  });
});
