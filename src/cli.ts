#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createNormalizer, type NormalizeResult } from "./normalize.js";
import type { Over99 } from "./numerals.js";
import { mapSrtText } from "./srt.js";

/** Everything the CLI touches outside itself, so tests can run it without a process. */
export interface CliIO {
  readStdin(): Promise<string>;
  readFile(path: string): string;
  stdout(text: string): void;
  stderr(text: string): void;
  stdinIsTTY: boolean;
}

type Mode = "text" | "json" | "table" | "ssml" | "srt";

interface Parsed {
  help: boolean;
  version: boolean;
  debug: boolean;
  mode: Mode;
  over99: Over99;
  input: string | undefined;
}

const HELP = `hangul-readout - read Korean text the way a person says it, for TTS.

Usage:
  hangul-readout [options] [file | -]

With no file (or "-") the text is read from standard input.

Options:
  --json         print { text, spans } as JSON
  --table        print a table of what changed (source, reading, rule, position)
  --ssml         print SSML with <sub alias="..."> around each change
  --srt          treat the input as an SRT file; keep numbers and times, rewrite dialogue
  --over99 <m>   how native counters read 100 and above: "mixed" (default) or "sino"
  --debug        print a stack trace on errors
  --help         show this help
  --version      show the version

Exit codes: 0 success, 2 usage or input error (one line on stderr, no stack trace).

Examples:
  echo "사과 3개" | hangul-readout
  hangul-readout --table notes.txt
  hangul-readout --srt narration.srt > narration.read.srt
`;

class UsageError extends Error {}

function parseArgs(argv: string[]): Parsed {
  const parsed: Parsed = {
    help: false,
    version: false,
    debug: false,
    mode: "text",
    over99: "mixed",
    input: undefined,
  };
  let optionsDone = false;
  const setMode = (mode: Mode, flag: string): void => {
    if (parsed.mode !== "text" && parsed.mode !== mode) {
      throw new UsageError(`${flag} cannot be combined with --${parsed.mode}. Pick one output mode.`);
    }
    parsed.mode = mode;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (optionsDone || arg === "-" || !arg.startsWith("-")) {
      if (parsed.input !== undefined) {
        throw new UsageError(`expected at most one input, got ${JSON.stringify(parsed.input)} and ${JSON.stringify(arg)}.`);
      }
      parsed.input = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    switch (name) {
      case "--":
        optionsDone = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--version":
      case "-v":
        parsed.version = true;
        break;
      case "--debug":
        parsed.debug = true;
        break;
      case "--json":
      case "--table":
      case "--ssml":
      case "--srt":
        setMode(name.slice(2) as Mode, name);
        break;
      case "--over99": {
        const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
        if (value !== "mixed" && value !== "sino") {
          throw new UsageError(`--over99 must be "mixed" or "sino", got ${value === undefined ? "nothing" : JSON.stringify(value)}.`);
        }
        parsed.over99 = value;
        break;
      }
      default:
        throw new UsageError(`unknown option ${name}`);
    }
  }
  return parsed;
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** Terminal columns of a string: Hangul and other East Asian wide characters take two. */
function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    width += WIDE.test(ch) || cp >= 0x1f300 ? 2 : 1;
  }
  return width;
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

function renderTable(result: NormalizeResult): string {
  if (result.spans.length === 0) return "(nothing to change)\n";
  const rows = [
    ["SOURCE", "READING", "RULE", "POS"],
    ...result.spans.map((s) => [s.source, s.reading, s.rule, `${s.start}-${s.end}`]),
  ];
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => displayWidth(r[col]))));
  return rows.map((r) => r.map((cell, col) => pad(cell, widths[col])).join("  ").trimEnd()).join("\n") + "\n";
}

function ensureNewline(s: string): string {
  return s === "" || s.endsWith("\n") ? s : s + "\n";
}

function packageVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    return (JSON.parse(readFileSync(url, "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function readInput(parsed: Parsed, io: CliIO): Promise<string> {
  if (parsed.input === undefined || parsed.input === "-") {
    if (parsed.input === undefined && io.stdinIsTTY) {
      throw new UsageError('no input. Pass a file, "-" for standard input, or pipe text in. See --help.');
    }
    return io.readStdin();
  }
  const path = parsed.input;
  try {
    return Promise.resolve(io.readFile(path));
  } catch (err) {
    const code = (err as { code?: string }).code;
    const reason =
      code === "ENOENT" ? "no such file"
      : code === "EISDIR" ? "it is a directory"
      : code === "EACCES" ? "permission denied"
      : (err as Error).message;
    throw new UsageError(`cannot read ${JSON.stringify(path)}: ${reason}`);
  }
}

/** Run the CLI. Returns the exit code: 0 on success, 2 on any usage or input error. */
export async function main(argv: string[], io: CliIO): Promise<number> {
  let debug = argv.includes("--debug");
  try {
    const parsed = parseArgs(argv);
    debug = parsed.debug;
    if (parsed.help) {
      io.stdout(HELP);
      return 0;
    }
    if (parsed.version) {
      io.stdout(packageVersion() + "\n");
      return 0;
    }
    const text = await readInput(parsed, io);
    const normalizer = createNormalizer({ over99: parsed.over99 });
    switch (parsed.mode) {
      case "json":
        io.stdout(JSON.stringify(normalizer.normalize(text), null, 2) + "\n");
        break;
      case "table":
        io.stdout(renderTable(normalizer.normalize(text)));
        break;
      case "ssml":
        // A final line break is not speech; keep it outside the <speak> element.
        io.stdout(ensureNewline(normalizer.toSSML(text.replace(/\r?\n$/, ""))));
        break;
      case "srt":
        io.stdout(mapSrtText(text, (line) => normalizer.normalize(line).text));
        break;
      default:
        io.stdout(ensureNewline(normalizer.normalize(text).text));
    }
    return 0;
  } catch (err) {
    // Anything unexpected is still reported as one line, never as a stack trace.
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`hangul-readout: error: ${message.split("\n")[0]}\n`);
    if (debug && err instanceof Error && err.stack) io.stderr(err.stack + "\n");
    return 2;
  }
}

function realIO(): CliIO {
  // A closed pipe (for example `| head`) is not an error for us.
  process.stdout.on("error", () => undefined);
  return {
    async readStdin() {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    readFile: (path) => readFileSync(path, "utf8"),
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    stdinIsTTY: process.stdin.isTTY === true,
  };
}

function isEntryPoint(): boolean {
  try {
    const entry = process.argv[1];
    if (entry === undefined) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void main(process.argv.slice(2), realIO()).then((code) => {
    process.exitCode = code;
  });
}
