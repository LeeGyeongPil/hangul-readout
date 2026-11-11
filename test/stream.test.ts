import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HangulReadoutError, normalize, normalizeStream, sentences } from "../src/index.js";
import { collect, tokenStream, twoWaySplits } from "./helpers.js";

interface Case {
  name: string;
  tokens: string[];
  sentences: string[];
  texts: string[];
}

const CASES: Case[] = [
  {
    name: "decimal point split across tokens",
    tokens: ["거리는 3", ".", "5km 입니다", ". 다음은 ", "사과 3", "개예요. 끝"],
    sentences: ["거리는 3.5km 입니다.", "다음은 사과 3개예요.", "끝"],
    texts: ["거리는 삼 점 오 킬로미터 입니다.", "다음은 사과 세 개예요.", "끝"],
  },
  {
    name: "phone number split across tokens",
    tokens: ["연락처는 010-", "1234-", "5678 입니다. "],
    sentences: ["연락처는 010-1234-5678 입니다."],
    texts: ["연락처는 공일공, 일이삼사, 오육칠팔 입니다."],
  },
  {
    name: "fraction split across tokens",
    tokens: ["전체의 1/", "3만 남았어요."],
    sentences: ["전체의 1/3만 남았어요."],
    texts: ["전체의 삼분의 일만 남았어요."],
  },
  {
    name: "range split across tokens",
    tokens: ["2~", "3명이 왔어요."],
    sentences: ["2~3명이 왔어요."],
    texts: ["두세 명이 왔어요."],
  },
  {
    name: "list numbers are not sentence ends",
    tokens: ["준비물은 다음과 같습니다. 1. 물 2", "병 2. 우산 1개입니다. "],
    sentences: ["준비물은 다음과 같습니다.", "1. 물 2병 2. 우산 1개입니다."],
    texts: ["준비물은 다음과 같습니다.", "일. 물 두 병 이. 우산 한 개입니다."],
  },
  {
    name: "a line break ends a sentence",
    tokens: ["첫 줄 3개\n", "둘째 줄 2명"],
    sentences: ["첫 줄 3개", "둘째 줄 2명"],
    texts: ["첫 줄 세 개", "둘째 줄 두 명"],
  },
  {
    name: "ellipsis is a pause, not a sentence end",
    tokens: ["글쎄요... 그건 3개예요. 네"],
    sentences: ["글쎄요... 그건 3개예요.", "네"],
    texts: ["글쎄요... 그건 세 개예요.", "네"],
  },
  {
    name: "closing quote stays with its sentence; short sentences are joined",
    tokens: ['그가 "3개예요." 라고 했다. 끝'],
    sentences: ['그가 "3개예요."', "라고 했다. 끝"],
    texts: ['그가 "세 개예요."', "라고 했다. 끝"],
  },
  {
    name: "question and exclamation marks",
    tokens: ["정말요? 3개나요! 네"],
    sentences: ["정말요? 3개나요!", "네"],
    texts: ["정말요? 세 개나요!", "네"],
  },
  {
    name: "a dot inside a word does not end the sentence",
    tokens: ["주소는 example.com 이고 3.5km 거리예요. 끝"],
    sentences: ["주소는 example.com 이고 3.5km 거리예요.", "끝"],
    texts: ["주소는 example.com 이고 삼 점 오 킬로미터 거리예요.", "끝"],
  },
  {
    name: "round 2 rules: ranges, phone formats, 5G, 제N장, N대, degrees, markdown",
    tokens: [
      "회의는 5~", "6시, 기온은 -10°", "C, 속도는 100km", "/h 입니다. 문의는 (02) 123-", "4567 이고 5", "G 가 제1", "장 입니다. 20", "대 남성이 **3**", "개 샀어요. 비율은 1", ":1 입니다. 끝",
    ],
    sentences: [
      "회의는 5~6시, 기온은 -10°C, 속도는 100km/h 입니다.",
      "문의는 (02) 123-4567 이고 5G 가 제1장 입니다.",
      "20대 남성이 **3**개 샀어요.",
      "비율은 1:1 입니다.",
      "끝",
    ],
    texts: [
      "회의는 다섯 시에서 여섯 시, 기온은 영하 십 도, 속도는 백 킬로미터 퍼 아워 입니다.",
      "문의는 (공이), 일이삼, 사오육칠 이고 파이브지 가 제일 장 입니다.",
      "이십 대 남성이 **세** 개 샀어요.",
      "비율은 일 대 일 입니다.",
      "끝",
    ],
  },
];

describe("sentence chunking and normalizeStream", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const text = c.tokens.join("");
      const variants: [string, string[]][] = [
        ["original tokens", c.tokens],
        ["one character per token", [...text]],
        ["a single token", [text]],
        ...twoWaySplits(text).map((p, i): [string, string[]] => [`two-way split at ${i}`, p]),
      ];

      it("gives the expected sentences and readings for the original tokens", async () => {
        expect(await collect(sentences(tokenStream(c.tokens)))).toEqual(c.sentences);
        const items = await collect(normalizeStream(tokenStream(c.tokens)));
        expect(items.map((i) => i.sentence)).toEqual(c.sentences);
        expect(items.map((i) => i.text)).toEqual(c.texts);
      });

      it("gives the same result for every way of cutting the tokens", async () => {
        for (const [label, tokens] of variants) {
          const items = await collect(normalizeStream(tokenStream(tokens)));
          expect(items.map((i) => i.sentence), label).toEqual(c.sentences);
          expect(items.map((i) => i.text), label).toEqual(c.texts);
        }
      });
    });
  }

  it("accepts a plain array as the token source", async () => {
    expect(await collect(sentences(["거리는 3", ".", "5km 입니다."]))).toEqual(["거리는 3.5km 입니다."]);
  });

  it("returns spans that point into the sentence", async () => {
    const [item] = await collect(normalizeStream(["사과 3개예요."]));
    expect(item.sentence).toBe("사과 3개예요.");
    expect(item.spans).toEqual(normalize(item.sentence).spans);
  });

  it("gives the same output when the same input is run twice", async () => {
    const run = async (): Promise<string[]> =>
      (await collect(normalizeStream(tokenStream(CASES[0].tokens)))).map((i) => i.text);
    expect(await run()).toEqual(await run());
  });

  it("keeps two concurrent streams apart", async () => {
    const [a, b] = [CASES[0], CASES[4]];
    for (let round = 0; round < 25; round++) {
      const aTokens = round % 2 === 0 ? a.tokens : [...a.tokens.join("")];
      const bTokens = round % 3 === 0 ? [...b.tokens.join("")] : b.tokens;
      const [ra, rb] = await Promise.all([
        collect(normalizeStream(tokenStream(aTokens))),
        collect(normalizeStream(tokenStream(bTokens))),
      ]);
      expect(ra.map((i) => i.text)).toEqual(a.texts);
      expect(rb.map((i) => i.text)).toEqual(b.texts);
    }
  });

  it("does not use timers, clocks or random numbers", () => {
    const dir = new URL("../src/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(new URL(file, dir), "utf8");
      expect(source, file).not.toMatch(/setTimeout|setInterval|setImmediate|Date\.now|new Date|Math\.random|performance\.now/);
    }
  });

  it("rejects bad options and non-string tokens with a clear error", async () => {
    expect(() => sentences([], { maxChars: 0 })).toThrow(HangulReadoutError);
    expect(() => sentences([], { minChars: -1 })).toThrow(/minChars/);
    expect(() => sentences([], { minChars: 20, maxChars: 10 })).toThrow(/must not be larger/);
    expect(() => normalizeStream([], { over99: "x" as never })).toThrow(/mixed/);
    await expect(collect(sentences([1 as never]))).rejects.toThrow(/strings/);
  });

  it("yields nothing for an empty stream", async () => {
    expect(await collect(sentences([]))).toEqual([]);
    expect(await collect(sentences(["   ", "\n"]))).toEqual([]);
  });
});

describe("maxChars", () => {
  const INPUT = "연락처는 010-1234-5678 이고, 거리는 3.5km, 인원은 2~3명입니다.";
  const PROTECTED = ["010-1234-5678", "3.5km", "2~3명"];

  it("never cuts through 010-1234-5678, 3.5km or 2~3명", async () => {
    const chunks = await collect(sentences([INPUT], { maxChars: 12 }));
    expect(chunks).toEqual(["연락처는", "010-1234-5678", "이고, 거리는", "3.5km, 인원은", "2~3명입니다."]);
    for (const token of PROTECTED) {
      expect(chunks.filter((c) => c.includes(token)), token).toHaveLength(1);
    }
  });

  it("keeps every chunk within maxChars except a single long token", async () => {
    const chunks = await collect(sentences([INPUT], { maxChars: 12 }));
    for (const chunk of chunks) {
      expect(chunk.length <= 12 || !/\s/.test(chunk), chunk).toBe(true);
    }
  });

  it("gives chunks that read correctly and join back to the input", async () => {
    const chunks = await collect(sentences([INPUT], { maxChars: 12 }));
    const spoken = chunks.map((c) => normalize(c).text).join(" ");
    expect(spoken).toContain("공일공, 일이삼사, 오육칠팔");
    expect(spoken).toContain("삼 점 오 킬로미터");
    expect(spoken).toContain("두세 명");
    expect(chunks.join("").replace(/\s+/g, "")).toBe(INPUT.replace(/\s+/g, ""));
  });

  it("gives the same chunks for every way of cutting the tokens", async () => {
    const expected = await collect(sentences([INPUT], { maxChars: 12 }));
    for (const tokens of [[...INPUT], ...twoWaySplits(INPUT)]) {
      expect(await collect(sentences(tokenStream(tokens), { maxChars: 12 }))).toEqual(expected);
    }
  });

  it("does not split between a number and its counter", async () => {
    const chunks = await collect(sentences(["가나다라마바사 10 개를 샀어요 그리고 또 샀어요"], { maxChars: 10 }));
    expect(chunks.join(" ")).toContain("10 개를");
    expect(chunks.every((c) => !c.endsWith("10"))).toBe(true);
  });

  it("works for many limits without losing text", async () => {
    for (let max = 1; max <= 40; max++) {
      const chunks = await collect(sentences(tokenStream([...INPUT]), { maxChars: max, minChars: 0 }));
      expect(chunks.join("").replace(/\s+/g, ""), `maxChars=${max}`).toBe(INPUT.replace(/\s+/g, ""));
    }
  });
});

describe("long text without spaces (linear time)", () => {
  // Before the fix a one-character-at-a-time stream of 40,000 characters took about 40 seconds.
  const LONG = "가".repeat(40_000);

  it("finishes 40,000 single-character tokens quickly and loses nothing", async () => {
    const started = performance.now();
    const chunks = await collect(sentences([...LONG]));
    const elapsed = performance.now() - started;
    expect(chunks.join("")).toBe(LONG);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(2048); // hard cap
    expect(elapsed).toBeLessThan(8000);
  });

  it("emits pieces while the text is still arriving (speech does not stall)", async () => {
    let seen = 0;
    let seenAfterTokens = -1;
    let count = 0;
    const source = (async function* () {
      for (const ch of LONG) {
        count++;
        yield ch;
      }
    })();
    for await (const _piece of sentences(source)) {
      void _piece;
      if (seen++ === 0) seenAfterTokens = count;
    }
    expect(seenAfterTokens).toBeLessThanOrEqual(2049);
  });

  it("cuts at the same places however the tokens arrive", async () => {
    const text = "가".repeat(5000) + " 끝";
    const expected = await collect(sentences([text]));
    expect(await collect(sentences([...text]))).toEqual(expected);
    expect(await collect(sentences([text.slice(0, 1234), text.slice(1234)]))).toEqual(expected);
  });
});
