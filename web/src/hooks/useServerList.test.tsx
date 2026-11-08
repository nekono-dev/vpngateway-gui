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
