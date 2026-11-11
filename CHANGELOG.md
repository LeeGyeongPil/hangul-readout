# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-11-11

### Fixed
- README: removed the known-limitation note claiming `--table` ignores Hangul double width; the table already counts Hangul and other wide characters as two columns.
- README: the limitation note for a currency name after a space now says the name is read twice (`₩5,000 원` -> `오천 원 원`), matching the actual output.

## [0.1.2] - 2026-11-11

### Fixed
- A currency name written right after the symbol and number is read once (`₩5,000원` -> `오천 원`, `$5달러` -> `오 달러`), and the span covers it. A name after a space (`₩5,000 원`) and a name that belongs to another symbol (`$5원`) are left alone.

## [0.1.1] - 2026-11-11

### Fixed
- A decimal before a counter is read with the counter and a space (`1.5배` -> `일 점 오 배`, `2.5시간` -> `이 점 오 시간`), and the span now covers the counter.

## [0.1.0] - 2026-11-11

### Added
- `normalize()` and `createNormalizer()`: reads numbers, counters, units, dates, times, phone
  numbers, fractions, ranges, ordinals and small Latin abbreviations the way a person says them.
- `span` information (`start`/`end` in the original text, `outStart`/`outEnd` in the output).
- `toSSML()`: `<sub alias>` output with XML escaping.
- `sentences()` and `normalizeStream()`: sentence chunker for token streams with lookahead,
  decimal-point and list-number handling, and number-safe `maxChars` splitting.
- `readSino()`, `readNative()`, `readDigits()` number readers.
- `hangul-readout` CLI with text, `--json`, `--table`, `--ssml` and `--srt` output.
- Golden table of readings in `test/golden.json`.
- Rule names `protect`, `ratio` and `currency` for `disable`.

### Fixed
- "제" + number is read Sino-Korean whatever the counter (제1장 -> 제일 장).
- A round number before "대" is an age group (20대 -> 이십 대); vehicles stay native (2대 -> 두 대).
- Markdown emphasis between a number and its counter no longer hides the counter (**3**개 -> **세** 개).
  The marks are kept in the output, not removed.
- Phone numbers: representative numbers (1588-1234), "(02) 123-4567", space or dot separators,
  +82 numbers and the emergency numbers 112 / 119.
- Temperatures: "°C", "°F" and "°"; "-10°C" and "-0.5도" are "영하".
- A number glued to letters (5G, 3D, 1st, 1e5) is read whole through the abbreviation table or left alone.
- Ranges with a shared counter or unit (5~6시, 30~40%, 1~2만 원, 2-3명, 50~60대, bare 3~5) are read on
  both sides; ranges that cannot be read are left as written.
- 11/11 style dates, 1:1 and 16:9 ratios, $5 / ₩5000 currency, +3, URLs, IP addresses and version
  numbers, km/h, m/s, "3시30분" spacing, the counters 캔 and 강.
- Streaming: text without any space no longer takes quadratic time; pending text is cut at
  max(maxChars * 8, 2048) characters when no split point exists.
