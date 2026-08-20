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
    // Spec files, not test files: the repository's root `pnpm test` runs a
    // bare `node --test` whose default discovery matches *.test.ts and then
    // fails on vitest imports and the "~" alias. Node's patterns do not
    // include *.spec.ts, which keeps the two runners out of each other's way.
    include: ["tests/**/*.spec.ts"],
  },
});
