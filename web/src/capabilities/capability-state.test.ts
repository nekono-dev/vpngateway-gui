import { describe, expect, it } from "vitest";
import { connectBlockedReason, isAvailable, reasonOf, usesAutoConnect, type Capabilities } from "./capability-state";

const ok = { available: true };
const restricted = { available: false, reason: "planRestricted" as const, message: "無料プランでは接続先を選べません。" };
const unsupported = { available: false, reason: "unsupported" as const, message: "このVPNプロバイダでは利用できません" };
const notLoggedIn = { available: false, reason: "notLoggedIn" as const, message: "ログインしてください" };

const all = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  login: ok, logout: ok, connectToLocation: ok, connectAuto: ok, changeLocation: ok, disconnect: ok,
  locationList: ok, locationFavorites: ok, pingMeasurement: ok, ...overrides,
});

describe("capability-state", () => {
  it("取得できていない（undefined）間は制限しない", () => {
    expect(isAvailable(undefined, "connectToLocation")).toBe(true);
    expect(reasonOf(undefined, "locationList")).toBeUndefined();
    expect(usesAutoConnect(undefined)).toBe(false);
    expect(connectBlockedReason(undefined)).toBeUndefined();
  });

  it("実行不可なら理由文を返し、実行可なら返さない", () => {
    const caps = all({ locationList: restricted });
    expect(isAvailable(caps, "locationList")).toBe(false);
    expect(reasonOf(caps, "locationList")).toBe("無料プランでは接続先を選べません。");
    expect(reasonOf(caps, "disconnect")).toBeUndefined();
  });

  it("理由文の無い実行不可は汎用文にする", () => {
    expect(reasonOf(all({ logout: { available: false } }), "logout")).toBe("この操作は利用できません");
  });

  it("接続先を指定できず自動接続が使えるときだけ、［接続］を自動接続にする", () => {
    expect(usesAutoConnect(all({ connectToLocation: restricted }))).toBe(true);
    expect(usesAutoConnect(all())).toBe(false);
    expect(usesAutoConnect(all({ connectToLocation: restricted, connectAuto: notLoggedIn }))).toBe(false);
  });

  it("接続できない理由は、解消できる原因（未ログイン等）を非対応より優先する", () => {
    expect(connectBlockedReason(all({ connectToLocation: notLoggedIn, connectAuto: unsupported }))).toBe("ログインしてください");
    expect(connectBlockedReason(all({ connectToLocation: unsupported, connectAuto: notLoggedIn }))).toBe("ログインしてください");
    expect(connectBlockedReason(all({ connectToLocation: unsupported, connectAuto: unsupported }))).toBe("このVPNプロバイダでは利用できません");
    expect(connectBlockedReason(all())).toBeUndefined();
  });
});
