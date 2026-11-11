import { NATIVE_COUNTERS, SINO_COUNTERS } from "./data/counters.js";
import { UNITS } from "./data/units.js";
import { HangulReadoutError } from "./errors.js";
import { createNormalizer, type NormalizeResult } from "./normalize.js";
import { resolveOptions, type NormalizeOptions } from "./rules.js";

export interface ChunkOptions {
  /** A sentence shorter than this is joined with the next one. Default 8. */
  minChars?: number;
  /** Longer pending text is split at a comma or space. Default 160. */
  maxChars?: number;
}

interface ChunkConfig {
  minChars: number;
  maxChars: number;
  /** Words that may follow a number after a space ("3 개", "5 km"): never split between them. */
  protect: readonly string[];
  protectLen: number;
  /**
   * Pending text longer than this is cut even where there is no space (a long URL, base64, a
   * Japanese reply). Decided from the text alone, so it does not depend on how tokens arrive.
   */
  hardMax: number;
}

const TERMINAL = new Set([".", "!", "?", "…", "。", "！", "？"]);
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "」", "』", "】", "）"]);

/** ASCII fast path first: this runs for many characters per token. */
const isSpace = (ch: string): boolean =>
  ch === " " || (ch < "\u0080" ? ch >= "\t" && ch <= "\r" : /\s/.test(ch));
/** Emphasis marks that may sit between a number and its counter: "**3** 개". */
const isEmphasis = (ch: string): boolean => ch === "*" || ch === "_" || ch === "`";
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

function resolveChunkOptions(opts: ChunkOptions | undefined, extraWords: Iterable<string>): ChunkConfig {
  if (opts !== undefined && (opts === null || typeof opts !== "object")) {
    throw new HangulReadoutError("chunk options must be an object like { minChars, maxChars }.");
  }
  const maxChars = opts?.maxChars ?? 160;
  // The default minimum never exceeds a small custom maximum.
  const minChars = opts?.minChars ?? Math.min(8, typeof maxChars === "number" && maxChars >= 0 ? maxChars : 8);
  if (!Number.isInteger(minChars) || minChars < 0) {
    throw new HangulReadoutError(`minChars must be an integer >= 0, got ${String(minChars)}.`);
  }
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new HangulReadoutError(`maxChars must be an integer >= 1, got ${String(maxChars)}.`);
  }
  if (minChars > maxChars) {
    throw new HangulReadoutError(`minChars (${minChars}) must not be larger than maxChars (${maxChars}).`);
  }
  const protect = [...new Set([...extraWords])];
  return {
    minChars,
    maxChars,
    protect,
    protectLen: protect.reduce((n, w) => Math.max(n, w.length), 0),
    hardMax: Math.max(maxChars * 8, 2048),
  };
}

type Natural = { kind: "cut"; at: number } | { kind: "need"; at: number } | { kind: "none" };

/** "1. " or "12. " at the start of a line or after a space is a list number, not a sentence end. */
function isListNumber(buf: string, dot: number): boolean {
  let s = dot;
  while (s > 0 && isDigit(buf[s - 1])) s--;
  const len = dot - s;
  return len >= 1 && len <= 2 && (s === 0 || isSpace(buf[s - 1]));
}

/**
 * Find the first sentence end. The decision only looks at the text itself, never at how it
 * arrived, so any way of splitting the tokens gives the same sentences.
 * - "need": a candidate sits at the end of the buffer; the next characters decide it.
 */
function findNatural(buf: string, cfg: ChunkConfig, final: boolean): Natural {
  // A sentence end after maxChars is never used (the text is cut by length first), so stop looking there.
  for (let i = 0; i < buf.length && i <= cfg.maxChars; i++) {
    const ch = buf[i];
    if (ch === "\n") return { kind: "cut", at: i };
    if (!TERMINAL.has(ch)) continue;

    let k = i;
    while (k < buf.length && TERMINAL.has(buf[k])) k++;
    let e = k;
    while (e < buf.length && CLOSERS.has(buf[e])) e++;
    // Where the next visible character is, and whether a line break comes first.
    let n = e;
    while (n < buf.length && isSpace(buf[n])) n++;
    const lineBreak = buf.slice(e, n).includes("\n");
    if (n >= buf.length && !final && !lineBreak) return { kind: "need", at: e };

    const run = buf.slice(i, k);
    const spaceAfter = e >= buf.length || isSpace(buf[e]);
    let boundary: boolean;
    if (/[。！？]/.test(run)) boundary = true;
    else if (/[!?]/.test(run)) boundary = spaceAfter;
    else if (run === ".") boundary = spaceAfter && !isListNumber(buf, i); // "3.5", "a.com", "1. "
    else boundary = false; // "…" and ".." are pauses, not sentence ends
    if (boundary && buf.slice(0, e).trim().length < cfg.minChars) boundary = false;
    if (boundary) return { kind: "cut", at: e };
    i = e - 1; // continue after this run
  }
  return { kind: "none" };
}

type Candidate = "ok" | "no" | "wait";

/** Can the pending text be split before the space at `k`? */
function splitCandidate(buf: string, k: number, cfg: ChunkConfig, final: boolean): Candidate {
  if (k < 1 || !isSpace(buf[k]) || isSpace(buf[k - 1])) return "no";
  let p = k - 1;
  while (p > 0 && isEmphasis(buf[p])) p--; // "**3** 개": look through the emphasis marks
  if (!isDigit(buf[p]) || cfg.protectLen === 0) return "ok";
  // "3 개": do not split between a number and its counter or unit.
  let j = k;
  while (j < buf.length && isSpace(buf[j])) j++;
  if (!final && j + cfg.protectLen > buf.length) return "wait";
  const rest = buf.slice(j, j + cfg.protectLen);
  return cfg.protect.some((w) => rest.startsWith(w)) ? "no" : "ok";
}

/** Choose where to split text that is longer than maxChars. Returns -1 to wait for more text. */
function forcedCut(buf: string, cfg: ChunkConfig, final: boolean): number {
  for (let k = Math.min(cfg.maxChars, buf.length - 1); k >= 1; k--) {
    const c = splitCandidate(buf, k, cfg, final);
    if (c === "wait") return -1;
    if (c === "ok") return k;
  }
  // Nothing fits: the first token is longer than maxChars. Split right after it, or at hardMax.
  // Only whitespace can be a split point, so jump from one to the next instead of every character.
  const limit = Math.min(buf.length - 1, cfg.hardMax);
  const whitespace = /\s/g;
  whitespace.lastIndex = cfg.maxChars + 1;
  for (let m = whitespace.exec(buf); m !== null && m.index <= limit; m = whitespace.exec(buf)) {
    const c = splitCandidate(buf, m.index, cfg, final);
    if (c === "wait") return -1;
    if (c === "ok") return m.index;
  }
  if (buf.length > cfg.hardMax) {
    // No space within hardMax: cut there, but never between the two halves of a surrogate pair.
    const high = buf.charCodeAt(cfg.hardMax - 1);
    return high >= 0xd800 && high <= 0xdbff ? cfg.hardMax - 1 : cfg.hardMax;
  }
  return final ? buf.length : -1;
}

/** Take the next sentence off the front of `buf`, or return -1 when more text is needed. */
function nextCut(buf: string, cfg: ChunkConfig, final: boolean): number {
  const nat = findNatural(buf, cfg, final);
  if (nat.kind === "cut" && nat.at <= cfg.maxChars) return nat.at;
  if (nat.kind === "need" && nat.at <= cfg.maxChars) return -1;
  if (buf.length > cfg.maxChars) return forcedCut(buf, cfg, final);
  return final ? buf.length : -1;
}

async function* chunk(
  tokens: AsyncIterable<string> | Iterable<string>,
  cfg: ChunkConfig,
): AsyncGenerator<string> {
  let buf = "";
  const drain = function* (final: boolean): Generator<string> {
    for (;;) {
      buf = buf.trimStart();
      if (buf === "") return;
      const cut = nextCut(buf, cfg, final);
      if (cut < 0) return;
      const sentence = buf.slice(0, cut).trim();
      buf = buf.slice(cut);
      if (sentence !== "") yield sentence;
    }
  };
  for await (const token of tokens) {
    if (typeof token !== "string") {
      throw new HangulReadoutError(
        `token stream must yield strings, got ${token === null ? "null" : typeof token}.`,
      );
    }
    buf += token;
    yield* drain(false);
  }
  yield* drain(true);
}

function defaultWords(): string[] {
  return [...NATIVE_COUNTERS, ...SINO_COUNTERS, ...Object.keys(UNITS)];
}

/**
 * Cut a token stream (LLM output, for example) into sentences.
 * A sentence is only released once the characters after its end are known, so "3" + "." + "5km"
 * stays one sentence piece. Runs without timers: the same input always gives the same output.
 */
export function sentences(
  tokens: AsyncIterable<string> | Iterable<string>,
  opts?: ChunkOptions,
): AsyncGenerator<string> {
  const cfg = resolveChunkOptions(opts, defaultWords());
  return chunk(tokens, cfg);
}

/** sentences() followed by normalize(): one `{ sentence, text, spans }` per finished sentence. */
export function normalizeStream(
  tokens: AsyncIterable<string> | Iterable<string>,
  opts?: NormalizeOptions & ChunkOptions,
): AsyncGenerator<NormalizeResult & { sentence: string }> {
  const cfgNormalize = resolveOptions(opts);
  const normalizer = createNormalizer(opts);
  const chunkCfg = resolveChunkOptions(opts, [
    ...cfgNormalize.nativeCounters,
    ...cfgNormalize.sinoCounters,
    ...Object.keys(cfgNormalize.units),
  ]);
  const source = chunk(tokens, chunkCfg);
  return (async function* () {
    for await (const sentence of source) {
      yield { sentence, ...normalizer.normalize(sentence) };
    }
  })();
}
