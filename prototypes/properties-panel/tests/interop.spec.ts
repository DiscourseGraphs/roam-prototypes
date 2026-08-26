/* A source-level guard for a bug this repository has now shipped twice
 * (copy-for-latex, then properties-panel on its first preview).
 *
 * roamjs-components is CommonJS. This repository builds with esbuild in ESM
 * format, and its __toESM helper runs in Node-interop mode, where a default
 * import of a CommonJS module resolves to the whole module object. So
 *
 *   import addStyle from "roamjs-components/dom/addStyle";
 *   addStyle(css);
 *
 * compiles to a call on `{ default: fn }` and throws "is not a function" at
 * load. Named imports are unaffected, which is why `{ render }` and
 * `{ runExtension }` work and nothing warns you.
 *
 * Vitest cannot catch this: it resolves CommonJS with ordinary interop, so
 * the same code passes every unit test and only fails in the built bundle.
 * Hence a check on the source text (and a load check on the real bundle in
 * bundle.spec.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs with the prototype root as cwd.
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
