import { describe, expect, it } from "vitest";
import { HangulReadoutError, normalize, normalizeStream, sentences, toSSML } from "../src/index.js";
import { collect, expectSpanInvariants, mulberry32 } from "./helpers.js";

const WEIRD: [string, string][] = [
  ["empty", ""],
  ["spaces only", "   \t "],
  ["1000 digits", "7".repeat(1000)],
  ["40 nines + counter", "9".repeat(40) + "개"],
  ["emoji", "👍🏽 사과 3개 👨‍👩‍👧‍👦 2명"],
  ["flags", "🇰🇷 3명"],
  ["lone high surrogate", "\uD800"],
  ["lone low surrogate then number", "\uDC00 3개"],
  ["control characters", "\u0000\u0001 3개\u001f\u007f"],
  ["CRLF", "1번\r\n2번\r\n"],
  ["mixed scripts", "MP3 파일 3개와 漢字 2本"],
  ["kana", "ひらがな3つ カタカナ2個"],
  ["double minus", "--3"],
  ["double dot", "3..5"],
  ["divide by zero", "1/0"],
  ["leading tilde", "~3명"],
  ["only symbols", "-./~:,%℃"],
  ["number then nothing", "3"],
  ["lone minus", "-"],
  ["time overflow", "99:99 25시 13월 2026-99-99"],
  ["huge comma number", "1,000,000,000,000,000,000,000,000원"],
  ["nbsp", "3 개 5 km"],
];

function expectClean(text: string): void {
  expect(text).not.toMatch(/NaN|undefined|Infinity/);
}

describe("unexpected strings never throw", () => {
  for (const [name, input] of WEIRD) {
    it(name, async () => {
      const result = normalize(input);
      expectClean(result.text);
      expectSpanInvariants(input, result);
      expect(typeof toSSML(input)).toBe("string");
      const chunks = await collect(sentences([input], { maxChars: 7 }));
      expect(chunks.join("").replace(/\s+/g, "")).toBe(input.replace(/\s+/g, ""));
      for await (const item of normalizeStream([...input])) expectClean(item.text);
    });
  }

  it("returns an empty result for the empty string", () => {
    expect(normalize("")).toEqual({ text: "", spans: [] });
    expect(toSSML("")).toBe("<speak></speak>");
  });

  it("reads a 1000-digit number digit by digit", () => {
    const result = normalize("7".repeat(1000));
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0].rule).toBe("digits");
    expect(result.text).toBe("칠".repeat(1000));
  });

  it("reads 40 nines followed by a counter digit by digit", () => {
    const result = normalize("9".repeat(40) + "개");
    expect(result.text).toBe("구".repeat(40) + "개");
  });

  it("handles a 200 KB text in time and keeps the invariants", () => {
    const unit = "사과 3개를 샀고 3.5km를 걸었다. 연락처는 010-1234-5678 입니다. ";
    const input = unit.repeat(Math.ceil(200_000 / unit.length));
    expect(input.length).toBeGreaterThanOrEqual(200_000);
    const result = normalize(input);
    expect(result.spans.length).toBeGreaterThan(10_000);
    expectSpanInvariants(input, result);
  });
});

describe("seeded random strings", () => {
  const PIECES = [
    "0", "1", "2", "3", "7", "9", "00", "10", "100", "12,345", "3.5", "-", "--", ".", "..", ",", "~", "/", ":", "%",
    "개", "명", "번", "번째", "시", "시간", "분", "월", "일", "원", "km", "kg", "℃", "AI", "A4", "MP3", "v2.0",
    "사과", "안녕", "입니다", "요", " ", " ", " ", "\n", "\r\n", "\t", "😀", "🇰🇷", "\uD800", "漢", "あ", "(", ")", "\"", "*",
    "010-1234-5678", "2026-11-11", "1/3", "2~3", "3:30", "!", "?", "…", "。",
  ];

  it("keeps the invariants on 1000 strings (seed 20261111)", () => {
    const rand = mulberry32(20261111);
    for (let n = 0; n < 1000; n++) {
      const length = 1 + Math.floor(rand() * 14);
      let input = "";
      for (let i = 0; i < length; i++) input += PIECES[Math.floor(rand() * PIECES.length)];
      const result = normalize(input);
      expectClean(result.text);
      expectSpanInvariants(input, result);
      expect(toSSML(input).match(/<sub /g)?.length ?? 0).toBe(result.spans.length);
    }
  });

  it("chunks random strings the same way however the tokens are cut", async () => {
    const rand = mulberry32(20261111);
    for (let n = 0; n < 150; n++) {
      const length = 1 + Math.floor(rand() * 14);
      let input = "";
      for (let i = 0; i < length; i++) input += PIECES[Math.floor(rand() * PIECES.length)];
      const maxChars = 6 + Math.floor(rand() * 20);
      const cut = Math.floor(rand() * (input.length + 1));
      const whole = await collect(sentences([input], { maxChars }));
      const split = await collect(sentences([input.slice(0, cut), input.slice(cut)], { maxChars }));
      const chars = await collect(sentences([...input], { maxChars }));
      expect(split, JSON.stringify(input)).toEqual(whole);
      expect(chars, JSON.stringify(input)).toEqual(whole);
      expect(whole.join("").replace(/\s+/g, ""), JSON.stringify(input)).toBe(input.replace(/\s+/g, ""));
    }
  });
});

describe("non-string input", () => {
  it("throws HangulReadoutError", () => {
    expect(() => normalize(null as never)).toThrow(HangulReadoutError);
    expect(() => normalize(undefined as never)).toThrow(/expected a string, got undefined/);
    expect(() => normalize(123 as never)).toThrow(HangulReadoutError);
    expect(() => toSSML(null as never)).toThrow(HangulReadoutError);
  });
});
