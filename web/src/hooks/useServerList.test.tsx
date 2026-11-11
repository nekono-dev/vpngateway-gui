import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getV1ConnectionLocationsCityIdServers } from "../generated/api/default/default";
import { useServerList } from "./useServerList";

vi.mock("../generated/api/default/default", () => ({ getV1ConnectionLocationsCityIdServers: vi.fn() }));

it("都市のサーバ一覧を取得する", async () => {
  const servers = [{ name: "server-1", tier: "paid" as const, load: 10, score: 1, favorite: false, connected: false }];
  vi.mocked(getV1ConnectionLocationsCityIdServers).mockResolvedValue({ data: servers, status: 200, headers: new Headers() });
  const { result } = renderHook(() => useServerList("city-1"));
  await waitFor(() => expect(result.current.servers).toEqual(servers));
  expect(result.current.error).toBeUndefined();
});

it("接続先と接続状態の変化で同じ都市の接続中バッジを取り直す", async () => {
  const base = { name: "server-1", tier: "paid" as const, load: 10, score: 1, favorite: false };
  const fetch = vi.mocked(getV1ConnectionLocationsCityIdServers);
  fetch.mockClear();
  fetch.mockResolvedValueOnce({ data: [{ ...base, connected: false }], status: 200, headers: new Headers() });
  const { result, rerender } = renderHook(({ status, location }) => useServerList("city-1", status, location), { initialProps: { status: "disconnected", location: "" } });
  await waitFor(() => expect(result.current.servers[0]?.connected).toBe(false));
  fetch.mockResolvedValueOnce({ data: [{ ...base, connected: true }], status: 200, headers: new Headers() });
  rerender({ status: "connected", location: "server-1" });
  await waitFor(() => expect(result.current.servers[0]?.connected).toBe(true));
  fetch.mockResolvedValueOnce({ data: [{ ...base, connected: false }], status: 200, headers: new Headers() });
  rerender({ status: "connected", location: "server-2" });
  await waitFor(() => expect(result.current.servers[0]?.connected).toBe(false));
  fetch.mockResolvedValueOnce({ data: [{ ...base, connected: false }], status: 200, headers: new Headers() });
  rerender({ status: "disconnected", location: "" });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
});
