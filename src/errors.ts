/**
 * Thrown only for caller mistakes: a non-string input, an invalid option value,
 * a malformed SRT file. Any string, however odd, never makes `normalize` throw.
 */
export class HangulReadoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HangulReadoutError";
  }
}
