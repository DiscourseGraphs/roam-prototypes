/* A source-level guard for a bug this repository shipped twice.
 *
 * roamjs-components is CommonJS; this repository builds with esbuild in ESM
 * format, and its __toESM helper runs in Node-interop mode: a default import
 * of a CommonJS module resolves to the whole module object, so
 * `import addStyle from "roamjs-components/dom/addStyle"` binds
 * `{ default: fn }` and throws "is not a function" at load. Named imports
 * are unaffected. Vitest cannot catch this (it resolves CommonJS with
 * ordinary interop), hence a check on the source text rather than behavior.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });

describe("module interop", () => {
  it("never default-imports from roamjs-components", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /^import\s+[A-Za-z_$][\w$]*\s*(,|from)/.test(line))
        .filter((line) => line.includes("roamjs-components"))
        .map((line) => `${file.replace(SRC, "src")}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("finds the source files it is supposed to be checking", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(4);
  });
});
