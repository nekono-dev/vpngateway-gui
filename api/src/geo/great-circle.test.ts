// 責務: 大圏距離と表示用の丸めを確かめる。
import { describe, expect, it } from "vitest";
import { greatCircleKm, roundToTenth } from "./great-circle.js";

const TOKYO = { latitude: 35.6895, longitude: 139.6917 };
const OSAKA = { latitude: 34.6937, longitude: 135.5023 };
const LONDON = { latitude: 51.5019, longitude: -0.1187 };

describe("greatCircleKm", () => {
  it("東京–大阪は約 396.4 km", () => {
    expect(greatCircleKm(TOKYO, OSAKA)).toBeCloseTo(396.4, 0);
  });

  it("同一点の距離は 0", () => {
    expect(greatCircleKm(TOKYO, TOKYO)).toBe(0);
  });

  it("入れ替えても同じ値になる（対称）", () => {
    expect(greatCircleKm(TOKYO, LONDON)).toBeCloseTo(greatCircleKm(LONDON, TOKYO), 9);
  });

  it("有限でない座標は例外にする", () => {
    expect(() => greatCircleKm({ latitude: Number.NaN, longitude: 0 }, TOKYO)).toThrow(RangeError);
  });
});

describe("roundToTenth", () => {
  it("小数点以下第一位へ丸める", () => {
    expect(roundToTenth(1234.56)).toBe(1234.6);
    expect(roundToTenth(0.04)).toBe(0);
    expect(roundToTenth(0)).toBe(0);
  });
});
