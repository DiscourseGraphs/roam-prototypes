import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The generated tsconfig declares a "~/*" path alias and the esbuild CLI
  // honours it, but the generated vitest config does not. Mirrored here.
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
    setupFiles: ["tests/setup.ts"],
    // Spec files, not test files: the repository root's test runner picks up
    // dot-test files itself and cannot resolve vitest or the alias.
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
  },
});
