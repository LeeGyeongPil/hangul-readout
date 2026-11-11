import { describe, expect, it } from "vitest";
import { HangulReadoutError, createNormalizer, normalize } from "../src/index.js";

describe("option validation", () => {
  it("rejects a bad over99 value and says what is allowed", () => {
    expect(() => normalize("3개", { over99: "foo" as never })).toThrow(/"mixed" or "sino"/);
  });

  it("rejects an empty counter, unit key or abbreviation", () => {
    expect(() => createNormalizer({ counters: { native: [""] } })).toThrow(HangulReadoutError);
    expect(() => createNormalizer({ counters: { sino: "개" as never } })).toThrow(/array/);
    expect(() => createNormalizer({ units: { "": "x" } })).toThrow(/empty key/);
    expect(() => createNormalizer({ abbreviations: { RAG: 3 as never } })).toThrow(/string reading/);
    expect(() => createNormalizer({ units: [] as never })).toThrow(/object/);
  });

  it("rejects an unknown rule name and lists the valid ones", () => {
    expect(() => createNormalizer({ disable: ["nope" as never] })).toThrow(/Valid names: phone/);
  });

  it("rejects options that are not an object", () => {
    expect(() => createNormalizer(5 as never)).toThrow(/options must be an object/);
    expect(() => createNormalizer(null as never)).toThrow(HangulReadoutError);
  });
});

describe("options in use", () => {
  it("falls back to the plain number rule for a decimal counter when sino-counter is disabled", () => {
    expect(normalize("1.5배", { disable: ["sino-counter"] }).text).toBe("일 점 오배");
  });

  it("does not change the options object it was given", () => {
    const options = Object.freeze({
      over99: "sino" as const,
      counters: Object.freeze({ native: Object.freeze(["포기"]) as unknown as string[] }),
      disable: Object.freeze(["abbreviation"]) as unknown as ("abbreviation")[],
    });
    expect(normalize("3포기 120명 AI", options).text).toBe("세 포기 백이십 명 AI");
  });

  it("gives the same result from a reused normalizer and a fresh call", () => {
    const n = createNormalizer({ abbreviations: { RAG: "래그" } });
    for (let i = 0; i < 3; i++) {
      expect(n.normalize("RAG 3개").text).toBe("래그 세 개");
    }
    expect(normalize("RAG 3개").text).toBe("RAG 세 개");
  });

  it("disables only the named rule", () => {
    expect(normalize("010-1234-5678", { disable: ["phone"] }).text).toBe("공일공-천이백삼십사-오천육백칠십팔");
  });

  it("switches the round-2 rules off by name", () => {
    expect(normalize("$5", { disable: ["currency"] }).text).toBe("$오");
    expect(normalize("1:1", { disable: ["ratio"] }).text).toBe("일:일");
    expect(normalize("1.2.3", { disable: ["protect"] }).text).toBe("일 점 이.3");
    expect(normalize("11/11", { disable: ["fraction"] }).text).toBe("십일/십일");
  });
});
