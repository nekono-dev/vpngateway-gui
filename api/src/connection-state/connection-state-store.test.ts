// 責務: 接続先（ID・国）の永続化と、観測した接続状態との突き合わせ（reconcileLocation）の単体テスト。

import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const stateDir = mkdtempSync(join(tmpdir(), "vpngwgui-state-"));
process.env.STATE_DIR = stateDir;
const P = "adguardvpn";
const stateFile = join(stateDir, "providers", P, "connection-state.json");

const { clearConnectedLocation, reconcileLocation, saveConnectedLocation } = await import("./connection-state-store.js");

const JP = { locationId: "jp-tokyo", country: "jp" };

describe("connection-state-store", () => {
  beforeEach(() => {
    clearConnectedLocation(P);
  });

  it("保存した国は、接続先が一致する接続中の観測に付与される（プロセスをまたぐリロード相当）", () => {
    saveConnectedLocation(P, JP, "TOKYO");
    expect(reconcileLocation(P, { status: "connected", location: "TOKYO" })).toEqual({
      status: "connected",
      location: "TOKYO",
      country: "jp",
      locationId: "jp-tokyo",
    });
    // 何度観測しても保持される（GETのたびに消えない）。
    expect(reconcileLocation(P, { status: "connected", location: "TOKYO" }).country).toBe("jp");
  });

  it("未保存なら国を付与しない", () => {
    expect(reconcileLocation(P, { status: "connected", location: "TOKYO" })).toEqual({
      status: "connected",
      location: "TOKYO",
    });
  });

  it("切断を観測したら保存内容を消し、以降の接続中観測にも古い国を付与しない", () => {
    saveConnectedLocation(P, JP, "TOKYO");
    expect(reconcileLocation(P, { status: "disconnected" })).toEqual({ status: "disconnected" });
    expect(existsSync(stateFile)).toBe(false);
    expect(reconcileLocation(P, { status: "connected", location: "TOKYO" }).country).toBeUndefined();
  });

  it("接続先の都市名が保存時と異なる（別経路で再接続された）場合は国を付与せず保存内容を消す", () => {
    saveConnectedLocation(P, JP, "TOKYO");
    expect(reconcileLocation(P, { status: "connected", location: "BRUSSELS" }).country).toBeUndefined();
    expect(existsSync(stateFile)).toBe(false);
  });

  it("都市名がどちらかで不明な場合は判定できないため保存内容を信頼する", () => {
    saveConnectedLocation(P, { locationId: "us-new-york", country: "us" }, undefined);
    expect(reconcileLocation(P, { status: "connected", location: "NEW YORK" }).country).toBe("us");
    saveConnectedLocation(P, JP, "TOKYO");
    expect(reconcileLocation(P, { status: "connected" }).country).toBe("jp");
  });

  it("Phase 8より前に保存されたファイル（locationIdなし）でも国を付与し、locationIdは付与しない", () => {
    writeFileSync(stateFile, JSON.stringify({ country: "jp", location: "TOKYO" }));
    expect(reconcileLocation(P, { status: "connected", location: "TOKYO" })).toEqual({
      status: "connected",
      location: "TOKYO",
      country: "jp",
    });
  });

  it("保存ファイルが破損していても例外にせず国なしで返す", () => {
    writeFileSync(stateFile, "{not json");
    expect(reconcileLocation(P, { status: "connected", location: "TOKYO" }).country).toBeUndefined();
    writeFileSync(stateFile, JSON.stringify({ country: 5 }));
    expect(reconcileLocation(P, { status: "connected" }).country).toBeUndefined();
  });

  it("ベンダーごとに独立に保存され、あるベンダーの切断観測が別のベンダーの保存内容を消さない", () => {
    saveConnectedLocation(P, JP, "TOKYO");
    saveConnectedLocation("mockproton", { locationId: "us-united-states", country: "us" }, "NEW YORK");
    reconcileLocation("mockproton", { status: "disconnected" });
    expect(reconcileLocation(P, { status: "connected", location: "TOKYO" }).country).toBe("jp");
    expect(reconcileLocation("mockproton", { status: "connected", location: "NEW YORK" }).country).toBeUndefined();
  });
});
