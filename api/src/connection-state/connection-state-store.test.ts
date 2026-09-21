// 責務: 接続先（ID・国）の永続化と、観測した接続状態との突き合わせ（reconcileLocation）の単体テスト。

import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const stateFile = join(mkdtempSync(join(tmpdir(), "vpngwgui-state-")), "connection-state.json");
process.env.CONNECTION_STATE_FILE = stateFile;

const { clearConnectedLocation, reconcileLocation, saveConnectedLocation } = await import("./connection-state-store.js");

const JP = { locationId: "jp-tokyo", country: "jp" };

describe("connection-state-store", () => {
  beforeEach(() => {
    clearConnectedLocation();
  });

  it("保存した国は、接続先が一致する接続中の観測に付与される（プロセスをまたぐリロード相当）", () => {
    saveConnectedLocation(JP, "TOKYO");
    expect(reconcileLocation({ status: "connected", location: "TOKYO" })).toEqual({
      status: "connected",
      location: "TOKYO",
      country: "jp",
      locationId: "jp-tokyo",
    });
    // 何度観測しても保持される（GETのたびに消えない）。
    expect(reconcileLocation({ status: "connected", location: "TOKYO" }).country).toBe("jp");
  });

  it("未保存なら国を付与しない", () => {
    expect(reconcileLocation({ status: "connected", location: "TOKYO" })).toEqual({
      status: "connected",
      location: "TOKYO",
    });
  });

  it("切断を観測したら保存内容を消し、以降の接続中観測にも古い国を付与しない", () => {
    saveConnectedLocation(JP, "TOKYO");
    expect(reconcileLocation({ status: "disconnected" })).toEqual({ status: "disconnected" });
    expect(existsSync(stateFile)).toBe(false);
    expect(reconcileLocation({ status: "connected", location: "TOKYO" }).country).toBeUndefined();
  });

  it("接続先の都市名が保存時と異なる（別経路で再接続された）場合は国を付与せず保存内容を消す", () => {
    saveConnectedLocation(JP, "TOKYO");
    expect(reconcileLocation({ status: "connected", location: "BRUSSELS" }).country).toBeUndefined();
    expect(existsSync(stateFile)).toBe(false);
  });

  it("都市名がどちらかで不明な場合は判定できないため保存内容を信頼する", () => {
    saveConnectedLocation({ locationId: "us-new-york", country: "us" }, undefined);
    expect(reconcileLocation({ status: "connected", location: "NEW YORK" }).country).toBe("us");
    saveConnectedLocation(JP, "TOKYO");
    expect(reconcileLocation({ status: "connected" }).country).toBe("jp");
  });

  it("Phase 8より前に保存されたファイル（locationIdなし）でも国を付与し、locationIdは付与しない", () => {
    writeFileSync(stateFile, JSON.stringify({ country: "jp", location: "TOKYO" }));
    expect(reconcileLocation({ status: "connected", location: "TOKYO" })).toEqual({
      status: "connected",
      location: "TOKYO",
      country: "jp",
    });
  });

  it("保存ファイルが破損していても例外にせず国なしで返す", () => {
    writeFileSync(stateFile, "{not json");
    expect(reconcileLocation({ status: "connected", location: "TOKYO" }).country).toBeUndefined();
    writeFileSync(stateFile, JSON.stringify({ country: 5 }));
    expect(reconcileLocation({ status: "connected" }).country).toBeUndefined();
  });
});
