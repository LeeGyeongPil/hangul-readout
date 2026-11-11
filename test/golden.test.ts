import { describe, expect, it } from "vitest";
import { normalize } from "../src/index.js";
import { loadGolden } from "./helpers.js";

const rows = loadGolden();

describe("golden table", () => {
  it("has the rows the plan requires", () => {
    expect(rows.length).toBeGreaterThanOrEqual(60);
  });

  for (const row of rows) {
    const name = JSON.stringify(row.input) + (row.options ? ` ${JSON.stringify(row.options)}` : "");
    it(name, () => {
      expect(normalize(row.input, row.options).text).toBe(row.expected);
    });
  }
});
