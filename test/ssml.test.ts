import { describe, expect, it } from "vitest";
import { createNormalizer, normalize, toSSML } from "../src/index.js";
import { loadGolden } from "./helpers.js";

describe("toSSML", () => {
  it("wraps each change in <sub alias>", () => {
    expect(toSSML("사과 3개")).toBe('<speak>사과 <sub alias="세 개">3개</sub></speak>');
  });

  it("escapes XML special characters in text, alias and source", () => {
    expect(toSSML("A&B <x> 3개")).toBe('<speak>A&amp;B &lt;x&gt; <sub alias="세 개">3개</sub></speak>');
    expect(toSSML('"q" \'s\' 3개')).toBe('<speak>&quot;q&quot; &apos;s&apos; <sub alias="세 개">3개</sub></speak>');
    const withQuoteAlias = toSSML("3m", { units: { m: 'a"b' } });
    expect(withQuoteAlias).toBe('<speak><sub alias="삼 a&quot;b">3m</sub></speak>');
  });

  it("adds no <sub> when nothing changes", () => {
    expect(toSSML("안녕하세요")).toBe("<speak>안녕하세요</speak>");
    expect(toSSML("안녕하세요")).not.toContain("<sub");
  });

  it("can leave out the <speak> wrapper", () => {
    expect(toSSML("사과 3개", { speak: false })).toBe('사과 <sub alias="세 개">3개</sub>');
  });

  it("has as many balanced <sub> tags as spans on every golden row", () => {
    for (const row of loadGolden()) {
      const spans = normalize(row.input, row.options).spans.length;
      const ssml = toSSML(row.input, row.options);
      expect(ssml.match(/<sub /g)?.length ?? 0, row.input).toBe(spans);
      expect(ssml.match(/<\/sub>/g)?.length ?? 0, row.input).toBe(spans);
    }
  });

  it("works through a reusable normalizer", () => {
    const n = createNormalizer();
    expect(n.toSSML("3개")).toBe('<speak><sub alias="세 개">3개</sub></speak>');
    expect(n.toSSML("3개", { speak: false })).toBe('<sub alias="세 개">3개</sub>');
  });

  it("wraps a currency symbol and its own unit in one sub", () => {
    expect(toSSML("₩5,000원")).toBe('<speak><sub alias="오천 원">₩5,000원</sub></speak>');
  });
});
