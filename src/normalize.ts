import { HangulReadoutError } from "./errors.js";
import {
  buildRules,
  resolveOptions,
  type NormalizeOptions,
  type RuleName,
} from "./rules.js";
import { renderSSML } from "./ssml.js";

export interface Span {
  /** Start offset in the original text (UTF-16 code units, same as String.prototype.slice). */
  start: number;
  /** End offset (exclusive) in the original text. */
  end: number;
  /** Start offset in the output text. */
  outStart: number;
  /** End offset (exclusive) in the output text. */
  outEnd: number;
  /** The original text of the changed part. */
  source: string;
  /** What it was changed into. */
  reading: string;
  rule: RuleName;
}

export interface NormalizeResult {
  text: string;
  spans: Span[];
}

export interface Normalizer {
  normalize(text: string): NormalizeResult;
  toSSML(text: string, opts?: { speak?: boolean }): string;
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLatin = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

function describe(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/** Can a number start at `i`? Not inside "A4", "v2.0" or the tail of "1.2.3". */
function startsNumber(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text.charCodeAt(i - 1);
  if (isLatin(prev) || isDigit(prev)) return false;
  if (prev === 46 && i >= 2 && isDigit(text.charCodeAt(i - 2))) return false;
  return true;
}

/** Is a leading "-" a minus sign? Only after whitespace, an opening bracket or a separator. */
function minusAllowed(text: string, i: number): boolean {
  return i === 0 || /[\s(\[{"'“‘:,;=]/.test(text[i - 1]);
}

const CURRENCY = "$₩€¥£";

/** Can a rule start at `i`? A digit, a sign before a digit, or a currency symbol before a digit. */
function startsRule(text: string, i: number, c: number): boolean {
  if (isDigit(c)) return startsNumber(text, i);
  if (!isDigit(text.charCodeAt(i + 1))) return false;
  if (c === 45 || c === 43) return minusAllowed(text, i); // "-" or "+"
  return CURRENCY.includes(text[i]);
}

/** "http://", "https://", "ftp://" and "www." start a URL that is never read. */
function isUrlStart(text: string, i: number, word: string): boolean {
  const next = i + word.length;
  if (/^(?:https?|ftp)$/i.test(word)) return text.startsWith("://", next);
  return /^www$/i.test(word) && text[next] === ".";
}

function assertString(text: unknown, fn: string): asserts text is string {
  if (typeof text !== "string") {
    throw new HangulReadoutError(`${fn}(): expected a string, got ${describe(text)}.`);
  }
}

/**
 * Compile the options once and get a reusable normalizer. The instance holds only
 * immutable data; every call keeps its own local state, so several streams can run at once.
 */
export function createNormalizer(opts?: NormalizeOptions): Normalizer {
  const cfg = resolveOptions(opts);
  const rules = buildRules(cfg);
  const abbreviations = new Map(Object.entries(cfg.abbreviations));
  const abbreviationOn = !cfg.disabled.has("abbreviation");

  function normalize(text: string): NormalizeResult {
    assertString(text, "normalize");
    // Regex objects carry lastIndex, so every call gets its own copies.
    const compiled = rules.map((rule) => ({ rule, re: new RegExp(rule.source, "y") }));
    const latinWord = /[A-Za-z][A-Za-z0-9]*(?:[.\-]\d[A-Za-z0-9]*)*/y;
    // "5G", "3D", "1st", "1e5": a number glued to letters is one token, read whole or not at all.
    const numberFirstToken = /\d[\d.,]*[A-Za-z][A-Za-z0-9]*/y;
    // A URL is left alone from "http://" up to a space, a closing bracket or a Korean letter.
    const urlRest = /[^\s)\]>"'<「」가-힣]*/y;
    const spans: Span[] = [];
    const parts: string[] = [];
    let last = 0; // start of the original text not yet copied to the output
    let outLen = 0;
    let i = 0;

    while (i < text.length) {
      const c = text.charCodeAt(i);
      let start = i;
      let end = -1;
      let reading = "";
      let rule: RuleName = "number";

      if (isLatin(c)) {
        // Take the whole Latin word, so digits inside "MP3" or "COVID-19" are never read.
        latinWord.lastIndex = i;
        const word = (latinWord.exec(text) as RegExpExecArray)[0];
        const wordEnd = i + word.length;
        if (isUrlStart(text, i, word)) {
          urlRest.lastIndex = wordEnd;
          i = wordEnd + (urlRest.exec(text) as RegExpExecArray)[0].length;
          continue;
        }
        const mapped = abbreviationOn && (i === 0 || !isDigit(text.charCodeAt(i - 1)))
          ? abbreviations.get(word)
          : undefined;
        if (mapped === undefined) {
          i = wordEnd;
          continue;
        }
        end = wordEnd;
        reading = mapped;
        rule = "abbreviation";
      } else if (startsRule(text, i, c)) {
        let keep = false;
        for (const { rule: def, re } of compiled) {
          re.lastIndex = i;
          const m = re.exec(text);
          if (m === null) continue;
          const hit = def.read(m, text, i);
          if (hit === null) continue;
          end = i + m[0].length;
          reading = hit.reading;
          rule = hit.rule ?? def.name;
          keep = hit.keep === true;
          break;
        }
        if (end < 0) {
          i++;
          continue;
        }
        if (keep) {
          i = end; // recognised, but not safe to read: leave it as written
          continue;
        }
        if (isLatin(text.charCodeAt(end))) {
          // The number runs into letters. Read the whole token (5G) or none of it (1st).
          const digitStart = isDigit(c) ? i : i + 1;
          numberFirstToken.lastIndex = digitStart;
          const token = numberFirstToken.exec(text);
          if (token !== null) {
            const mapped = abbreviationOn ? abbreviations.get(token[0]) : undefined;
            if (mapped === undefined) {
              i = digitStart + token[0].length;
              continue;
            }
            start = digitStart;
            end = digitStart + token[0].length;
            reading = mapped;
            rule = "abbreviation";
          }
        }
        // "3시30분": a reading that ends in Korean text must not run into the next digits.
        if (isDigit(text.charCodeAt(end)) && /[가-힣]$/.test(reading)) reading += " ";
      } else {
        i++;
        continue;
      }

      if (start > last) {
        parts.push(text.slice(last, start));
        outLen += start - last;
      }
      parts.push(reading);
      spans.push({
        start,
        end,
        outStart: outLen,
        outEnd: outLen + reading.length,
        source: text.slice(start, end),
        reading,
        rule,
      });
      outLen += reading.length;
      last = end;
      i = end;
    }
    if (last < text.length) parts.push(text.slice(last));
    return { text: parts.join(""), spans };
  }

  return {
    normalize,
    toSSML(text: string, ssmlOpts?: { speak?: boolean }): string {
      return renderSSML(text, normalize(text), ssmlOpts?.speak !== false);
    },
  };
}

/** Normalize text for speech: numbers, counters, units and dates become what a person reads aloud. */
export function normalize(text: string, opts?: NormalizeOptions): NormalizeResult {
  return createNormalizer(opts).normalize(text);
}

/** Like normalize(), but returns SSML where each change is `<sub alias="reading">source</sub>`. */
export function toSSML(text: string, opts?: NormalizeOptions & { speak?: boolean }): string {
  return createNormalizer(opts).toSSML(text, { speak: opts?.speak });
}
