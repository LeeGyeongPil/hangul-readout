import { susa } from "es-hangul";
import { describe, expect, it } from "vitest";
import { HangulReadoutError, readDigits, readNative, readSino } from "../src/index.js";

describe("readNative", () => {
  it("matches es-hangul susa(n, true) for 1..99", () => {
    for (let n = 1; n <= 99; n++) {
      expect(readNative(n, { attributive: true }), `n=${n}`).toBe(susa(n, true));
    }
  });

  it("matches es-hangul susa(n) for 1..99 (plain form)", () => {
    for (let n = 1; n <= 99; n++) {
      expect(readNative(n), `n=${n}`).toBe(susa(n));
    }
  });

  it("reads past 99 where es-hangul throws", () => {
    expect(() => susa(101, true)).toThrow();
    expect(readNative(101, { attributive: true })).toBe("백한");
    expect(readNative(120, { attributive: true })).toBe("백스무");
    expect(readNative(120, { attributive: true, over99: "sino" })).toBe("백이십");
    expect(readNative(1000, { attributive: true })).toBe("천");
  });

  it("reads zero and rejects bad input with a fix hint", () => {
    expect(readNative(0)).toBe("영");
    expect(() => readNative(-1)).toThrow(HangulReadoutError);
    expect(() => readNative(1.5)).toThrow(/safe integer/);
    expect(() => readNative(3, { over99: "foo" as never })).toThrow(/"mixed" or "sino"/);
  });
});

describe("readSino", () => {
  it("drops 일 before 만 and before 십·백·천", () => {
    expect(readSino(10000)).toBe("만");
    expect(readSino(12345n)).toBe("만 이천삼백사십오");
    expect(readSino(11)).toBe("십일");
    expect(readSino(1000)).toBe("천");
    expect(readSino(0)).toBe("영");
  });

  it("keeps 일 before 억·조·경", () => {
    expect(readSino(100000000n)).toBe("일억");
    expect(readSino("1000000000000")).toBe("일조");
  });

  it("handles negatives, bigint and long digit strings without throwing", () => {
    expect(readSino(-3)).toBe("마이너스 삼");
    expect(readSino("12345678901234567")).toBe("일경 이천삼백사십오조 육천칠백팔십구억 백이십삼만 사천오백육십칠");
    const huge = readSino("9".repeat(40));
    expect(typeof huge).toBe("string");
    expect(huge).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("rejects values it cannot read with a hint", () => {
    expect(() => readSino(Number.MAX_SAFE_INTEGER + 2)).toThrow(/bigint or a digit string/);
    expect(() => readSino("12a")).toThrow(HangulReadoutError);
    expect(() => readSino(null as never)).toThrow(HangulReadoutError);
  });
});

describe("readDigits", () => {
  it("reads 0 as 공 and keeps other characters", () => {
    expect(readDigits("010")).toBe("공일공");
    expect(readDigits("1-2")).toBe("일-이");
    expect(readDigits("")).toBe("");
    expect(() => readDigits(5 as never)).toThrow(HangulReadoutError);
  });
});
