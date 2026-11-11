import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main, type CliIO } from "../src/cli.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
let scratch = "";

beforeAll(() => {
  if (!existsSync(cli)) throw new Error("dist/cli.js is missing. Run `npm run build` first (npm test does it for you).");
  scratch = mkdtempSync(join(tmpdir(), "hangul-readout-test-"));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function run(args: string[], input?: string): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [cli, ...args], { input: input ?? "", encoding: "utf8", cwd: root, timeout: 30_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function expectOneLineError(err: string): void {
  expect(err).toMatch(/^hangul-readout: error: [^\n]+\n$/);
  expect(err).not.toContain("    at ");
  expect(err).not.toMatch(/\bError:/);
}

describe("cli: success paths", () => {
  it("reads standard input", () => {
    expect(run([], "사과 3개")).toEqual({ code: 0, out: "사과 세 개\n", err: "" });
  });

  it("reads standard input given as -", () => {
    expect(run(["-"], "사과 3개\n")).toEqual({ code: 0, out: "사과 세 개\n", err: "" });
  });

  it("reads a file", () => {
    const r = run(["examples/sample.txt"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("열 시 십 분");
    expect(r.out.split("\n").length).toBe(readFileSync(join(root, "examples/sample.txt"), "utf8").split("\n").length);
  });

  it("--json prints valid JSON with one span", () => {
    const r = run(["--json"], "사과 3개");
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out) as { text: string; spans: unknown[] };
    expect(parsed.text).toBe("사과 세 개");
    expect(parsed.spans).toHaveLength(1);
  });

  it("--ssml starts with <speak>", () => {
    const r = run(["--ssml"], "사과 3개, A&B\n");
    expect(r.code).toBe(0);
    expect(r.out).toBe('<speak>사과 <sub alias="세 개">3개</sub>, A&amp;B</speak>\n');
  });

  it("--table lists what changed", () => {
    const r = run(["--table", "examples/sample.txt"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toMatch(/^SOURCE\s+READING\s+RULE\s+POS$/);
    expect(r.out).toContain("세 개");
    expect(r.out).toContain("삼 점 오 킬로미터");
    expect(r.out).toContain("공일공, 일이삼사, 오육칠팔");
  });

  it("--srt keeps numbers and time lines and rewrites only dialogue", () => {
    const original = readFileSync(join(root, "examples/sample.srt"), "utf8").split("\n");
    const r = run(["--srt", "examples/sample.srt"]);
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines).toHaveLength(original.length);
    original.forEach((line, i) => {
      if (/^\d+$/.test(line) || line.includes("-->") || line === "") expect(lines[i]).toBe(line);
    });
    expect(lines[2]).toBe("오늘은 사과 세 개와 배 스무 개를 샀어요.");
    expect(lines).toContain("기온은 영하 삼 도 였어요.");
  });

  it("--srt keeps CRLF line endings", () => {
    const file = join(scratch, "crlf.srt");
    writeFileSync(file, "1\r\n00:00:01,000 --> 00:00:02,000\r\n3개\r\n");
    expect(run(["--srt", file]).out).toBe("1\r\n00:00:01,000 --> 00:00:02,000\r\n세 개\r\n");
  });

  it("--over99 sino changes how native counters read 100+", () => {
    expect(run([], "120명").out).toBe("백스무 명\n");
    expect(run(["--over99", "sino"], "120명").out).toBe("백이십 명\n");
    expect(run(["--over99=sino"], "120명").out).toBe("백이십 명\n");
  });

  it("empty standard input gives empty output and exit 0", () => {
    expect(run([], "")).toEqual({ code: 0, out: "", err: "" });
  });

  it("--help and --version exit 0", () => {
    const help = run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("Usage:");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect(run(["--version"])).toEqual({ code: 0, out: pkg.version + "\n", err: "" });
  });

  it("works when started through a symlink, like an installed bin", () => {
    const bin = join(scratch, "bin");
    mkdirSync(bin);
    const link = join(bin, "hangul-readout");
    symlinkSync(cli, link);
    const r = spawnSync(process.execPath, [link], { input: "3개", encoding: "utf8", timeout: 30_000 });
    expect(r.stdout).toBe("세 개\n");
  });
});

describe("cli: input errors exit 2 with one line and no stack trace", () => {
  const broken = (): string => {
    const file = join(scratch, "broken.srt");
    writeFileSync(file, "1\n00:00:01,000 --> 00:00:02,000\n3개\n\n2\nnot a time line\n안녕\n");
    return file;
  };
  const notSrt = (): string => {
    const file = join(scratch, "plain.srt");
    writeFileSync(file, "그냥 글입니다\n");
    return file;
  };

  const cases: [string, () => { args: string[]; input?: string }, RegExp][] = [
    ["unknown option", () => ({ args: ["--nope"] }), /unknown option --nope\n$/],
    ["missing file", () => ({ args: ["/no/such/file.txt"] }), /cannot read .*no such file/],
    ["directory path", () => ({ args: [scratch] }), /cannot read .*directory/],
    ["bad --over99", () => ({ args: ["--over99", "foo"] }), /--over99 must be/],
    ["--over99 without value", () => ({ args: ["--over99"] }), /--over99 must be/],
    ["two inputs", () => ({ args: ["a.txt", "b.txt"] }), /at most one input/],
    ["conflicting modes", () => ({ args: ["--json", "--table"] }), /cannot be combined/],
    ["broken SRT", () => ({ args: ["--srt", broken()] }), /line 6: subtitle 2 needs a time line/],
    ["not an SRT", () => ({ args: ["--srt", notSrt()] }), /expected a subtitle number/],
  ];
  for (const [name, make, pattern] of cases) {
    it(name, () => {
      const { args, input } = make();
      const r = run(args, input);
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      expectOneLineError(r.err);
      expect(r.err).toMatch(pattern);
    });
  }

  it("prints the exact message for an unknown option", () => {
    expect(run(["--nope"]).err).toBe("hangul-readout: error: unknown option --nope\n");
  });

  it("--debug adds a stack trace, nothing else does", () => {
    const r = run(["--debug", "--nope"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("    at ");
  });
});

describe("cli: unexpected exceptions", () => {
  function fakeIO(overrides: Partial<CliIO>): { io: CliIO; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = {
      readStdin: () => Promise.resolve(""),
      readFile: () => "",
      stdout: (t) => void out.push(t),
      stderr: (t) => void err.push(t),
      stdinIsTTY: false,
      ...overrides,
    };
    return { io, out, err };
  }

  it("turns a surprise failure into one error line and exit 2", async () => {
    const { io, out, err } = fakeIO({
      readStdin: () => Promise.reject(new TypeError("boom\n    at somewhere (file.js:1:1)")),
    });
    expect(await main([], io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("")).toBe("hangul-readout: error: boom\n");
  });

  it("reports a thrown non-Error value without a stack", async () => {
    const { io, err } = fakeIO({ readStdin: () => Promise.reject("plain string") });
    expect(await main([], io)).toBe(2);
    expect(err.join("")).toBe("hangul-readout: error: plain string\n");
  });

  it("asks for input instead of hanging when stdin is a terminal", async () => {
    const { io, err } = fakeIO({ stdinIsTTY: true });
    expect(await main([], io)).toBe(2);
    expect(err.join("")).toMatch(/^hangul-readout: error: no input\./);
  });
});
