import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The generated tsconfig declares a "~/*" path alias and the esbuild CLI
  // honours it, but the generated vitest config does not, so a test that
  // imports the way the source does fails to resolve. Mirrored here
  // (same fix as copy-for-latex).
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
    // Spec files, not test files: the repository's root `pnpm test` runs a
    // bare `node --test` whose discovery would try to execute *.test.ts
    // itself and fail on the "~" alias. Node's patterns do not include
    // dot-spec, which keeps the two runners out of each other's way.
    include: ["tests/**/*.spec.ts"],
  },
});
