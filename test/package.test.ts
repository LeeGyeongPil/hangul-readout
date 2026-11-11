import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

interface Pkg {
  version: string;
  dependencies?: Record<string, string>;
  bin: Record<string, string>;
  engines: { node: string };
  type: string;
  exports: Record<string, unknown>;
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Pkg;

describe("package metadata (AC-10)", () => {
  it("has no runtime dependencies", () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it("points bin at dist/cli.js and declares ESM and the Node range", () => {
    expect(pkg.bin["hangul-readout"]).toBe("dist/cli.js");
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=22.12");
    expect(pkg.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
  });

  it("npm pack lists the built files and leaves out src and test", () => {
    const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const files = (JSON.parse(r.stdout) as { files: { path: string }[] }[])[0].files.map((f) => f.path);
    for (const wanted of ["dist/index.js", "dist/index.d.ts", "dist/cli.js", "LICENSE", "package.json"]) {
      expect(files, wanted).toContain(wanted);
    }
    // The README is written in the docs step; once it exists it must ship.
    if (existsSync(new URL("../README.md", import.meta.url))) expect(files).toContain("README.md");
    expect(files.filter((f) => f.startsWith("src/") || f.startsWith("test/"))).toEqual([]);
  });
});
