import { HangulReadoutError } from "./errors.js";

const TIME_LINE = /^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;

type State = "index" | "time" | "text";

/**
 * Rewrite the dialogue lines of an SRT file with `rewrite` and keep everything else
 * (numbers, time lines, blank lines, line endings) exactly as it is.
 * Throws HangulReadoutError with the line number when the file is not valid SRT.
 */
export function mapSrtText(srt: string, rewrite: (line: string) => string): string {
  if (typeof srt !== "string") {
    throw new HangulReadoutError(`SRT input must be a string, got ${typeof srt}.`);
  }
  const lines = srt.split(/(?<=\n)/);
  let state = "index" as State;
  let cue = 0;
  let out = "";
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const lineNo = idx + 1;
    const body = raw.replace(/\r?\n$/, "");
    const eol = raw.slice(body.length);
    const probe = (idx === 0 ? body.replace(/^﻿/, "") : body).trim();
    if (state === "index") {
      if (probe === "") {
        out += raw;
        continue;
      }
      if (!/^\d+$/.test(probe)) {
        throw new HangulReadoutError(
          `line ${lineNo}: expected a subtitle number, got ${JSON.stringify(probe.slice(0, 40))}. Is this an SRT file?`,
        );
      }
      cue++;
      state = "time";
      out += raw;
    } else if (state === "time") {
      if (!TIME_LINE.test(probe)) {
        throw new HangulReadoutError(
          `line ${lineNo}: subtitle ${cue} needs a time line like "00:00:01,000 --> 00:00:03,000", got ${JSON.stringify(probe.slice(0, 40))}.`,
        );
      }
      state = "text";
      out += raw;
    } else if (probe === "") {
      state = "index";
      out += raw;
    } else {
      out += rewrite(body) + eol;
    }
  }
  if (state === "time") {
    throw new HangulReadoutError(`subtitle ${cue} has no time line at the end of the file.`);
  }
  return out;
}
