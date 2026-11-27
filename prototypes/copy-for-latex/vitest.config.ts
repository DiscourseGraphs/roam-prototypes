import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The generated tsconfig declares a "~/*" path alias and the esbuild CLI
  // honours it, but the generated vitest config does not, so a test that
  // imports the way the source does fails to resolve. Mirrored here.
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
    // Spec files, not test files. The repository's root `pnpm test` runs a
    // bare `node --test`, whose default discovery walks the whole tree and
    // matches any dot-test dot-ts file. Prototype tests named that way get
    // picked up by Node's runner, which cannot resolve vitest or the "~"
    // alias, so the root command fails. Node's patterns do not include
    // dot-spec, which keeps the two runners out of each other's way.
    // The tidier fix is `node --test test/` at the root, but that is a
    // shared-tooling change, so it is reported rather than made here.
    include: ["tests/**/*.spec.ts"],
  },
});
