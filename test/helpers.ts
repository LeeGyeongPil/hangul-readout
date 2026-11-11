import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type { NormalizeOptions, NormalizeResult } from "../src/index.js";

export interface GoldenRow {
  input: string;
  expected: string;
  options?: NormalizeOptions;
  note?: string;
}

export function loadGolden(): GoldenRow[] {
  const url = new URL("./golden.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as GoldenRow[];
}

/** The offset invariants every normalize() result must keep (AC-3). */
export function expectSpanInvariants(input: string, result: NormalizeResult): void {
  let prevEnd = 0;
  let rebuilt = "";
  let copied = 0;
  for (const span of result.spans) {
    expect(input.slice(span.start, span.end)).toBe(span.source);
    expect(result.text.slice(span.outStart, span.outEnd)).toBe(span.reading);
    expect(span.start).toBeGreaterThanOrEqual(prevEnd); // sorted, no overlap
    expect(span.end).toBeGreaterThan(span.start);
    prevEnd = span.end;
    rebuilt += input.slice(copied, span.start) + span.reading;
    copied = span.end;
  }
  rebuilt += input.slice(copied);
  expect(rebuilt).toBe(result.text);
}

export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

/** An async token source that yields to the event loop between tokens. */
export async function* tokenStream(parts: readonly string[]): AsyncGenerator<string> {
  for (const part of parts) {
    await Promise.resolve();
    yield part;
  }
}

/** Every way to cut `text` into two tokens. */
export function twoWaySplits(text: string): string[][] {
  const out: string[][] = [];
  for (let i = 0; i <= text.length; i++) out.push([text.slice(0, i), text.slice(i)]);
  return out;
}

/** Deterministic pseudo-random numbers (mulberry32) so failures are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
