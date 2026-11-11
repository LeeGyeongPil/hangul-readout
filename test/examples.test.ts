import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function node(args: string[]): { code: number | null; out: string; err: string } {
  if (!existsSync(new URL("../dist/index.js", import.meta.url))) {
    throw new Error("dist/ is missing. Run `npm run build` first (npm test does it for you).");
  }
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("examples (AC-9)", () => {
  it("the sample table shows what changed", () => {
    const r = node(["dist/cli.js", "--table", "examples/sample.txt"]);
    expect(r.code).toBe(0);
    for (const wanted of ["세 개", "삼 점 오 킬로미터", "공일공, 일이삼사, 오육칠팔"]) {
      expect(r.out).toContain(wanted);
    }
  });

  it("fake-llm-stream.mjs prints tokens and sentences and ends with the distance sentence", () => {
    const r = node(["examples/fake-llm-stream.mjs"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("practice mock");
    expect(r.out).toContain('token    "5km 입니다."');
    const lines = r.out.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toContain("거리는 삼 점 오 킬로미터 입니다.");
    // The sentence is released only after later tokens arrive: lookahead is visible.
    expect(lines.indexOf('token    "사과 3"')).toBeLessThan(lines.indexOf("sentence 연락처는 010-1234-5678 입니다."));
  });

  it("basic.mjs runs", () => {
    const r = node(["examples/basic.mjs"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('<speak>사과 <sub alias="세 개">3개</sub></speak>');
  });
});
