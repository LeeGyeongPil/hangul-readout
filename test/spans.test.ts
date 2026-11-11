import { describe, expect, it } from "vitest";
import { normalize } from "../src/index.js";
import { expectSpanInvariants, loadGolden } from "./helpers.js";

describe("span offsets", () => {
  it("keep every invariant on every golden row", () => {
    for (const row of loadGolden()) {
      expectSpanInvariants(row.input, normalize(row.input, row.options));
    }
  });

  it("count UTF-16 units correctly around emoji", () => {
    const input = "👍 사과 3개, 🇰🇷 2~3명";
    const result = normalize(input);
    expect(result.text).toBe("👍 사과 세 개, 🇰🇷 두세 명");
    expect(result.spans).toHaveLength(2);
    expectSpanInvariants(input, result);
    // 👍 is two UTF-16 units, so "3개" starts at 6 and not at 5.
    expect(result.spans[0].start).toBe(6);
  });

  it("matches a literal expectation", () => {
    const input = "사과 3개와 배 20개";
    expect(normalize(input).spans).toEqual([
      { start: 3, end: 5, outStart: 3, outEnd: 6, source: "3개", reading: "세 개", rule: "native-counter" },
      { start: 9, end: 12, outStart: 10, outEnd: 14, source: "20개", reading: "스무 개", rule: "native-counter" },
    ]);
  });

  it("covers the counter after a decimal", () => {
    expect(normalize("1.5배와 2.5시간").spans).toEqual([
      { start: 0, end: 4, outStart: 0, outEnd: 7, source: "1.5배", reading: "일 점 오 배", rule: "sino-counter" },
      { start: 6, end: 11, outStart: 9, outEnd: 17, source: "2.5시간", reading: "이 점 오 시간", rule: "sino-counter" },
    ]);
  });

  it("returns no spans when nothing changes", () => {
    expect(normalize("안녕하세요")).toEqual({ text: "안녕하세요", spans: [] });
  });
});
