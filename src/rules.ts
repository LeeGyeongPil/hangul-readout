import { ABBREVIATIONS } from "./data/abbreviations.js";
import { NATIVE_COUNTERS, SINO_COUNTERS } from "./data/counters.js";
import {
  BEON_NUMBER_HINTS,
  BEON_PRECEDING_HINTS,
  MONTH_EXCEPTIONS,
  RANGE_PAIRS,
} from "./data/exceptions.js";
import { UNITS } from "./data/units.js";
import { HangulReadoutError } from "./errors.js";
import {
  assertOver99,
  nativeBig,
  readDigits,
  readFractionDigits,
  sinoBig,
  type Over99,
} from "./numerals.js";

export type RuleName =
  | "protect"
  | "phone"
  | "date"
  | "clock"
  | "ratio"
  | "fraction"
  | "range"
  | "unit"
  | "currency"
  | "month"
  | "hour"
  | "ordinal"
  | "beon"
  | "native-counter"
  | "sino-counter"
  | "digits"
  | "number"
  | "abbreviation";

/** Every rule name, in the order the scanner tries them (abbreviation works on Latin words). */
export const RULE_NAMES: readonly RuleName[] = [
  "phone", "date", "protect", "clock", "ratio", "fraction", "range", "unit", "currency", "month", "hour", "ordinal", "beon",
  "native-counter", "sino-counter", "digits", "number", "abbreviation",
];

export interface NormalizeOptions {
  /** How 100 and above are read with native counters. Default "mixed" (백스무 명); "sino" gives 백이십 명. */
  over99?: Over99;
  /** Extra counters, added to the built-in lists. A counter given here wins over the built-in class. */
  counters?: { native?: string[]; sino?: string[] };
  /** Extra unit symbols, e.g. { "㎡": "제곱미터" }. */
  units?: Record<string, string>;
  /** Extra Latin abbreviations, e.g. { RAG: "래그" }. Matched case-sensitively as whole words. */
  abbreviations?: Record<string, string>;
  /** Extra words that, right after "N번", make N a label (Sino-Korean) instead of a count. */
  beonNumberHints?: string[];
  /** Rules to switch off. */
  disable?: RuleName[];
}

/** Fully validated options with defaults applied. Immutable after creation. */
export interface ResolvedConfig {
  readonly over99: Over99;
  readonly nativeCounters: ReadonlySet<string>;
  readonly sinoCounters: ReadonlySet<string>;
  readonly units: Readonly<Record<string, string>>;
  readonly abbreviations: Readonly<Record<string, string>>;
  readonly beonHints: readonly string[];
  readonly disabled: ReadonlySet<RuleName>;
}

function fail(message: string): never {
  throw new HangulReadoutError(message);
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${name} must be an array of non-empty strings.`);
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      fail(`${name} must contain only non-empty strings, got ${JSON.stringify(item)}.`);
    }
  }
  return value.map((s: string) => s.trim());
}

function stringMap(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object like { "key": "reading" }.`);
  }
  const out: Record<string, string> = {};
  for (const [key, reading] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim() === "") fail(`${name} must not have an empty key.`);
    if (typeof reading !== "string") fail(`${name}[${JSON.stringify(key)}] must be a string reading.`);
    out[key.trim()] = reading;
  }
  return out;
}

/** Validate the options once and merge them with the built-in tables. Throws HangulReadoutError. */
export function resolveOptions(opts: NormalizeOptions | undefined): ResolvedConfig {
  if (opts !== undefined && (opts === null || typeof opts !== "object")) {
    fail(`options must be an object, got ${opts === null ? "null" : typeof opts}.`);
  }
  const o: NormalizeOptions = opts ?? {};
  assertOver99(o.over99);
  const extraNative = stringList(o.counters?.native, "counters.native");
  const extraSino = stringList(o.counters?.sino, "counters.sino");
  const native = new Set([...NATIVE_COUNTERS, ...extraNative]);
  const sino = new Set([...SINO_COUNTERS, ...extraSino]);
  // A user counter replaces the built-in class for the same word.
  for (const c of extraNative) sino.delete(c);
  for (const c of extraSino) native.delete(c);
  const disable = o.disable === undefined ? [] : o.disable;
  if (!Array.isArray(disable)) fail("disable must be an array of rule names.");
  for (const name of disable) {
    if (!RULE_NAMES.includes(name)) {
      fail(`unknown rule name ${JSON.stringify(name)} in disable. Valid names: ${RULE_NAMES.join(", ")}.`);
    }
  }
  return {
    over99: o.over99 ?? "mixed",
    nativeCounters: native,
    sinoCounters: sino,
    units: { ...UNITS, ...stringMap(o.units, "units") },
    abbreviations: { ...ABBREVIATIONS, ...stringMap(o.abbreviations, "abbreviations") },
    beonHints: [...BEON_NUMBER_HINTS, ...stringList(o.beonNumberHints, "beonNumberHints")],
    disabled: new Set(disable),
  };
}

export interface RuleHit {
  reading: string;
  /** Overrides the rule name when one matcher serves two rules (native/sino counters). */
  rule?: RuleName;
  /** Recognised but not safe to read: the scanner skips the match and leaves it as written. */
  keep?: boolean;
}

export interface RuleDef {
  name: RuleName;
  /** Regex source. It is compiled with the sticky flag for each normalize() call. */
  source: string;
  /** Returns null to decline the match so the next rule gets a chance. */
  read(m: RegExpExecArray, text: string, start: number): RuleHit | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest first, so "개월" is tried before "개". */
function alternation(words: Iterable<string>): string {
  return [...words].sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
}

const SP = "[ \\u00a0]?";
/** Markdown emphasis between a number and its counter: "**3**개". Kept in the output, never read. */
const MD = "[*_`]{0,3}";
/** Korean area codes without the leading 0 (2 = Seoul, 31..64, 70, 80, mobile 10/11/16..19). */
const AREA = "(?:1[016-9]|2|[3-6]\\d|70|80)";
/** "제" right before the number (not inside another Korean word). */
const ORDINAL_PREFIX = /(?:^|[^가-힣])제[ \u00a0]?$/;
const KEEP: RuleHit = { reading: "", keep: true };
const CURRENCY_NAMES: Readonly<Record<string, string>> = { $: "달러", "₩": "원", "€": "유로", "¥": "엔", "£": "파운드" };
/** Units after which a negative number is a temperature: "-3℃" is "영하 삼 도". */
const TEMPERATURE_UNITS: ReadonlySet<string> = new Set(["℃", "°C", "°F", "°"]);
/** Integer with optional thousands separators. Never stops in the middle of a digit run. */
const INT = "(?:\\d{1,3}(?:,\\d{3})+(?!\\d)|\\d+)";

/**
 * Integer value of a digit string, or null when it should be read digit by digit:
 * leading zero ("007"), 17+ digits without commas, or 21+ digits in any form.
 */
export function intValue(raw: string): bigint | null {
  const hasComma = raw.includes(",");
  const digits = hasComma ? raw.replace(/,/g, "") : raw;
  if (digits.length >= 2 && digits[0] === "0") return null;
  if (!hasComma && digits.length >= 17) return null;
  if (digits.length >= 21) return null;
  return BigInt(digits);
}

function decimalReading(whole: bigint, fraction: string | undefined): string {
  const head = sinoBig(whole);
  return fraction === undefined ? head : `${head} 점 ${readFractionDigits(fraction)}`;
}

function monthReading(month: number): string {
  return MONTH_EXCEPTIONS[month] ?? `${sinoBig(BigInt(month))} 월`;
}

/** Build the ordered rule list for a resolved configuration. */
export function buildRules(cfg: ResolvedConfig): RuleDef[] {
  const nativeAttr = (n: bigint): string => nativeBig(n, true, cfg.over99);
  const counterAlts = alternation([...cfg.nativeCounters, ...cfg.sinoCounters]);
  const unitAlts = alternation(Object.keys(cfg.units));
  const hintAlts = alternation(cfg.beonHints);
  const precedingHint = new RegExp(`(?:${alternation(BEON_PRECEDING_HINTS)})[ \\u00a0]*$`);
  // After the hint word there must be a word break or a particle: "3번 출구로" yes, "3번 방법" no.
  const followingHint = hintAlts === ""
    ? null
    : new RegExp(
        `^[ \\u00a0]?(?:${hintAlts})(?:(?![가-힣])|(?:으로는|으로|에서는|에서|에는|에도|에|은|는|이|가|을|를|도|의|과|와|로))`,
      );

  const rules: RuleDef[] = [];
  const add = (def: RuleDef): void => {
    if (!cfg.disabled.has(def.name)) rules.push(def);
  };

  // A number right before a counter or unit is a quantity: "112명", "1600-1800년".
  const quantityAfter = new RegExp(`^[ \\u00a0]?(?:${counterAlts}|${unitAlts})`);
  const phoneReading = (...groups: string[]): string => groups.map(readDigits).join(", ");

  // 010-1234-5678, 010.1234.5678, 010 1234 5678, 02-123-4567, (02) 123-4567
  add({
    name: "phone",
    source: `(0${AREA})(\\)[ ]?|[-. ])(\\d{3,4})[-. ](\\d{4})(?!\\d)`,
    read: (m) => ({
      reading: `${readDigits(m[1])}${m[2].startsWith(")") ? ")" : ""}, ${phoneReading(m[3], m[4])}`,
    }),
  });
  // +82-10-1234-5678 (the "+" belongs to the match; the scanner starts on it)
  add({
    name: "phone",
    source: `\\+82[-. ]?\\(?0?(${AREA})\\)?[-. ](\\d{3,4})[-. ](\\d{4})(?!\\d)`,
    read: (m) => ({ reading: `플러스 팔이, ${phoneReading(m[1], m[2], m[3])}` }),
  });
  // Representative numbers 1588-1234, 1600-1234 (not a year range such as 1600-1800년)
  add({
    name: "phone",
    source: "1[568]\\d{2}-\\d{4}(?!\\d)",
    read: (m, text, start) =>
      quantityAfter.test(text.slice(start + m[0].length, start + m[0].length + 8))
        ? null
        : { reading: phoneReading(...m[0].split("-")) },
  });
  // Emergency numbers are read one digit at a time.
  add({
    name: "phone",
    source: "(?:112|119)(?![\\d~]|[-,.]\\d)",
    read: (m, text, start) =>
      quantityAfter.test(text.slice(start + 3, start + 11)) ? null : { reading: readDigits(m[0]) },
  });

  add({
    name: "date",
    source: "(\\d{4})([-./])(\\d{1,2})\\2(\\d{1,2})(?!\\d)",
    read: (m) => {
      const month = Number(m[3]);
      const day = Number(m[4]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return { reading: `${sinoBig(BigInt(m[1]))} 년 ${monthReading(month)} ${sinoBig(BigInt(day))} 일` };
    },
  });

  // 1.2.3 and 192.168.0.1 are version numbers and addresses: left as written.
  add({
    name: "protect",
    source: "\\d+(?:\\.\\d+){2,}(?!\\d)",
    read: () => KEEP,
  });

  add({
    name: "clock",
    source: "(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?!\\d)",
    read: (m) => {
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      const second = m[3] === undefined ? 0 : Number(m[3]);
      if (hour > 24 || minute > 59 || second > 59) return null;
      let reading = `${nativeAttr(BigInt(hour))} 시`;
      if (minute > 0) reading += ` ${sinoBig(BigInt(minute))} 분`;
      if (second > 0) reading += ` ${sinoBig(BigInt(second))} 초`;
      return { reading };
    },
  });

  // 1:1 and 16:9 are ratios or scores: "일 대 일".
  add({
    name: "ratio",
    source: "(\\d{1,4}):(\\d{1,4})(?![\\d:])",
    read: (m) => {
      if ((m[1].length > 1 && m[1][0] === "0") || (m[2].length > 1 && m[2][0] === "0")) return null;
      return { reading: `${sinoBig(BigInt(m[1]))} 대 ${sinoBig(BigInt(m[2]))}` };
    },
  });

  add({
    name: "fraction",
    source: "(\\d{1,6})/(\\d{1,6})(?![\\d/])",
    read: (m) => {
      if (m[1].length > 1 && m[1][0] === "0") return null;
      if (m[2][0] === "0") return null; // 1/0 and 1/05 are not fractions
      // 11/11 and 12/25: two digits each with a month and a day in range is a date, not a fraction.
      if (m[1].length === 2 && m[2].length === 2 && Number(m[1]) <= 12 && Number(m[2]) <= 31) {
        return { reading: `${monthReading(Number(m[1]))} ${sinoBig(BigInt(m[2]))} 일`, rule: "date" };
      }
      return { reading: `${sinoBig(BigInt(m[2]))}분의 ${sinoBig(BigInt(m[1]))}` };
    },
  });

  // Ranges: 5~6시, 30~40%, 1~2만 원, 2-3명, 50~60대 and a bare 3~5. Hyphens only with a counter or unit.
  const rangeTails = alternation([
    ...cfg.nativeCounters, ...cfg.sinoCounters, ...Object.keys(cfg.units), "번", "시", "월",
  ]);
  const isDecade = (n: bigint): boolean => n >= 10n && n <= 90n && n % 10n === 0n;
  add({
    name: "range",
    source: `(${INT})(?:\\.(\\d+))?([~\\-–])(${INT})(?:\\.(\\d+))?(?:(만|억)?${SP}(${rangeTails})(?![A-Za-z째]))?`,
    read: (m, text, start) => {
      const [whole, aInt, aFrac, sep, bInt, bFrac, mult, tail] = m;
      const a = intValue(aInt);
      const b = intValue(bInt);
      if (a === null || b === null) return tail === undefined ? null : KEEP; // 01~02월: no half readings
      const hasFraction = aFrac !== undefined || bFrac !== undefined;
      const both = (n: bigint, f: string | undefined, o: bigint, g: string | undefined): string =>
        `${decimalReading(n, f)}에서 ${decimalReading(o, g)}`;
      if (tail === undefined) {
        return sep === "~" ? { reading: both(a, aFrac, b, bFrac) } : null;
      }
      if (tail === "시") {
        if (text[start + whole.length] === "즌" || mult !== undefined) return null; // 시즌
        if (hasFraction || a > 24n || b > 24n) return null;
        return { reading: `${nativeAttr(a)} 시에서 ${nativeAttr(b)} 시` };
      }
      if (tail === "월") {
        if (mult !== undefined || hasFraction || a < 1n || a > 12n || b < 1n || b > 12n) return null;
        return { reading: `${monthReading(Number(a))}에서 ${monthReading(Number(b))}` };
      }
      if (mult === undefined && (cfg.nativeCounters.has(tail) || tail === "번")) {
        if (hasFraction) return KEEP;
        if (tail === "대" && isDecade(a) && isDecade(b)) {
          return { reading: `${sinoBig(a)}에서 ${sinoBig(b)} 대` };
        }
        const pair = RANGE_PAIRS[`${a}-${b}`];
        return { reading: `${pair ?? `${nativeAttr(a)}에서 ${nativeAttr(b)}`} ${tail}` };
      }
      return { reading: `${both(a, aFrac, b, bFrac)}${mult ?? ""} ${cfg.units[tail] ?? tail}` };
    },
  });

  add({
    name: "unit",
    source: `([-+]?)(${INT})(?:\\.(\\d+))?(${MD})${SP}(${unitAlts})(?![A-Za-z])`,
    read: (m) => {
      const whole = intValue(m[2]);
      if (whole === null) return null;
      const unit = m[5];
      const isTemperature = TEMPERATURE_UNITS.has(unit);
      let prefix = unit === "°F" ? "화씨 " : "";
      if (m[1] === "-") prefix += isTemperature ? "영하 " : "마이너스 ";
      else if (m[1] === "+") prefix += "플러스 ";
      return { reading: `${prefix}${decimalReading(whole, m[3])}${m[4]} ${cfg.units[unit]}` };
    },
  });

  // "-0.5도": below zero, the same "영하" as "-0.5℃" (a plain "도" is a Sino-Korean counter).
  add({
    name: "unit",
    source: `-(${INT})(?:\\.(\\d+))?${SP}도(?:(?![가-힣])|(?=에|까지|이하|이상|는|가|의|부터|를|와|과))`,
    read: (m) => {
      const whole = intValue(m[1]);
      return whole === null ? null : { reading: `영하 ${decimalReading(whole, m[2])} 도` };
    },
  });

  // $5, ₩5000, €3.50: the symbol moves behind the number, as people say it.
  add({
    name: "currency",
    source: `([$₩€¥£])(${INT})(?:\\.(\\d+))?`,
    read: (m) => {
      const whole = intValue(m[2]);
      return whole === null ? null : { reading: `${decimalReading(whole, m[3])} ${CURRENCY_NAMES[m[1]]}` };
    },
  });

  add({
    name: "month",
    source: "(\\d{1,2})월",
    read: (m) => {
      const month = Number(m[1]);
      return month >= 1 && month <= 12 ? { reading: monthReading(month) } : null;
    },
  });

  add({
    name: "hour",
    source: "(\\d{1,2})시(?!간)",
    read: (m) => {
      const hour = Number(m[1]);
      return hour <= 24 ? { reading: `${nativeAttr(BigInt(hour))} 시` } : null;
    },
  });

  add({
    name: "ordinal",
    source: `(${INT})번째`,
    read: (m) => {
      const n = intValue(m[1]);
      if (n === null) return null;
      return { reading: `${n === 1n ? "첫" : nativeAttr(n)} 번째` };
    },
  });

  add({
    name: "beon",
    source: `(${INT})${SP}번(?![째지호])`,
    read: (m, text, start) => {
      const n = intValue(m[1]);
      if (n === null) return null;
      const before = text.slice(Math.max(0, start - 12), start);
      const after = text.slice(start + m[0].length, start + m[0].length + 24);
      const isLabel = precedingHint.test(before) || (followingHint !== null && followingHint.test(after));
      return { reading: `${isLabel ? sinoBig(n) : nativeAttr(n)} 번` };
    },
  });

  // One matcher serves both counter rules, so the longest counter always wins ("3개월" is not "3개" + "월").
  const countersOn = !cfg.disabled.has("native-counter") || !cfg.disabled.has("sino-counter");
  if (countersOn && counterAlts !== "") {
    rules.push({
      name: "native-counter",
      source: `(${INT})(?:\\.(\\d+))?(${MD})${SP}(${counterAlts})`,
      read: (m, text, start) => {
        const n = intValue(m[1]);
        if (n === null) return null;
        const counter = m[4];
        // 1.5배, 2.5시간: a decimal is always read Sino-Korean, whatever the counter.
        if (m[2] !== undefined) {
          if (cfg.disabled.has("sino-counter")) return null;
          return { reading: `${decimalReading(n, m[2])}${m[3]} ${counter}`, rule: "sino-counter" };
        }
        // 제1장, 제 2권: after "제" the number is an ordinal, always Sino-Korean.
        // 20대, 30대 남성: a round number before "대" is an age group, not a count of vehicles.
        const ordinal = ORDINAL_PREFIX.test(text.slice(Math.max(0, start - 3), start));
        const decade = counter === "대" && n >= 10n && n <= 90n && n % 10n === 0n;
        const isNative = cfg.nativeCounters.has(counter) && !ordinal && !decade;
        const rule: RuleName = isNative ? "native-counter" : "sino-counter";
        if (cfg.disabled.has(rule)) return null;
        return { reading: `${isNative ? nativeAttr(n) : sinoBig(n)}${m[3]} ${counter}`, rule };
      },
    });
  }

  add({
    name: "digits",
    source: INT,
    read: (m) => {
      // Only digit strings that are not numbers: leading zero, 17+ digits.
      if (intValue(m[0]) !== null) return null;
      return { reading: readDigits(m[0].replace(/,/g, "")) };
    },
  });

  add({
    name: "number",
    source: `([-+]?)(${INT})(?:\\.(\\d+))?`,
    read: (m) => {
      const whole = intValue(m[2]);
      if (whole === null) return null;
      const sign = m[1] === "-" ? "마이너스 " : m[1] === "+" ? "플러스 " : "";
      return { reading: `${sign}${decimalReading(whole, m[3])}` };
    },
  });

  return rules;
}
