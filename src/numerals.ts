import { HangulReadoutError } from "./errors.js";

/** Primitive number readers. Pure functions, no shared state. */

const SINO_DIGITS = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL_UNITS = ["", "십", "백", "천"];
const BIG_UNITS = ["", "만", "억", "조", "경"];
/** Numbers at or above this are read digit by digit (beyond the 경 unit). */
const SINO_LIMIT = 10n ** 20n;

const NATIVE_ONES = ["", "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"];
const NATIVE_ONES_ATTR = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
const NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];

export type Over99 = "mixed" | "sino";

function toBigInt(n: unknown, fn: string): bigint {
  if (typeof n === "bigint") return n;
  if (typeof n === "number") {
    if (!Number.isSafeInteger(n)) {
      throw new HangulReadoutError(
        `${fn}(): expected a safe integer, got ${String(n)}. Pass a bigint or a digit string for larger values.`,
      );
    }
    return BigInt(n);
  }
  if (typeof n === "string") {
    if (!/^-?\d+$/.test(n)) {
      throw new HangulReadoutError(`${fn}(): expected a string of digits like "12345", got ${JSON.stringify(n)}.`);
    }
    return BigInt(n);
  }
  throw new HangulReadoutError(`${fn}(): expected a number, bigint or digit string, got ${typeof n}.`);
}

/** Sino-Korean reading of an integer: 12345 -> "만 이천삼백사십오". */
export function readSino(n: number | bigint | string): string {
  return sinoBig(toBigInt(n, "readSino"));
}

/** Internal: Sino-Korean reading of a bigint. */
export function sinoBig(value: bigint): string {
  if (value === 0n) return "영";
  if (value < 0n) return "마이너스 " + sinoBig(-value);
  if (value >= SINO_LIMIT) return readDigits(value.toString());
  const groups: string[] = [];
  let rest = value;
  for (let group = 0; rest > 0n; group++) {
    const part = Number(rest % 10000n);
    rest /= 10000n;
    if (part === 0) continue;
    let text = "";
    const digits = String(part).padStart(4, "0");
    for (let i = 0; i < 4; i++) {
      const d = Number(digits[i]);
      if (d === 0) continue;
      const pos = 3 - i;
      // "일십"/"일백"/"일천" are spoken without the leading 일.
      text += (d === 1 && pos > 0 ? "" : SINO_DIGITS[d]) + SMALL_UNITS[pos];
    }
    // "일만" is spoken as "만".
    if (group === 1 && part === 1) text = "";
    groups.unshift(text + BIG_UNITS[group]);
  }
  return groups.join(" ");
}

/** Digit-by-digit reading: "010" -> "공일공". Non-digit characters are kept as they are. */
export function readDigits(s: string): string {
  if (typeof s !== "string") {
    throw new HangulReadoutError(`readDigits(): expected a string, got ${typeof s}.`);
  }
  let out = "";
  for (const ch of s) {
    out += ch >= "0" && ch <= "9" ? (ch === "0" ? "공" : SINO_DIGITS[Number(ch)]) : ch;
  }
  return out;
}

/** Digit-by-digit reading used after a decimal point: 0 is "영" there ("3.05" -> "삼 점 영오"). */
export function readFractionDigits(s: string): string {
  let out = "";
  for (const ch of s) out += SINO_DIGITS[Number(ch)];
  return out;
}

export function assertOver99(value: unknown): asserts value is Over99 | undefined {
  if (value !== undefined && value !== "mixed" && value !== "sino") {
    throw new HangulReadoutError(`over99 must be "mixed" or "sino", got ${JSON.stringify(value)}.`);
  }
}

/** Internal: native Korean reading of a bigint. */
export function nativeBig(value: bigint, attributive: boolean, over99: Over99): string {
  if (value === 0n) return "영";
  if (value > 99n) {
    if (over99 === "sino") return sinoBig(value);
    // "mixed": hundreds and above are Sino-Korean, the last two digits are native (백스무, 백한).
    const rest = value % 100n;
    const head = value - rest;
    return sinoBig(head) + (rest === 0n ? "" : nativeBig(rest, attributive, over99));
  }
  const n = Number(value);
  if (attributive && n === 20) return "스무";
  const ones = attributive ? NATIVE_ONES_ATTR : NATIVE_ONES;
  return NATIVE_TENS[Math.floor(n / 10)] + ones[n % 10];
}

/**
 * Native Korean reading: readNative(3) -> "셋", readNative(3, { attributive: true }) -> "세".
 * Above 99 the default `over99: "mixed"` reads "백스무"; `"sino"` reads "백이십".
 */
export function readNative(
  n: number | bigint,
  opts: { attributive?: boolean; over99?: Over99 } = {},
): string {
  if (typeof n === "string") {
    throw new HangulReadoutError('readNative(): expected a number or bigint, got string. Use readSino for digit strings.');
  }
  const value = toBigInt(n, "readNative");
  if (value < 0n) {
    throw new HangulReadoutError(`readNative(): expected a non-negative integer, got ${value}.`);
  }
  assertOver99(opts.over99);
  return nativeBig(value, opts.attributive === true, opts.over99 ?? "mixed");
}
