import type { NormalizeResult } from "./normalize.js";

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escape the five XML special characters. */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

/**
 * Render a normalize() result as SSML. Text outside the spans stays as it is (escaped);
 * each span becomes `<sub alias="reading">source</sub>`, so the engine keeps the original
 * text for captions and timing while speaking the reading.
 */
export function renderSSML(text: string, result: NormalizeResult, speak: boolean): string {
  let out = "";
  let last = 0;
  for (const span of result.spans) {
    out += escapeXml(text.slice(last, span.start));
    out += `<sub alias="${escapeXml(span.reading)}">${escapeXml(span.source)}</sub>`;
    last = span.end;
  }
  out += escapeXml(text.slice(last));
  return speak ? `<speak>${out}</speak>` : out;
}
