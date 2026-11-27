/* Smoke test for the BUILT bundle, on the exact path previews load through.
 *
 * Unit tests exercise the source; nothing else exercises the artifact, and
 * the two differ in ways vitest cannot see (esbuild's CommonJS interop, the
 * host-globals plugin). This imports dist/extension.js with the host globals
 * stubbed and calls onload the way a roam/js `import()` block does —
 * `extensionAPI` undefined — which is the configuration that has eaten real
 * load errors before.
 *
 * Skipped when dist/ is absent (tests run before build in the repo order);
 * run `pnpm build && pnpm test` to include it.
 */
// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/* tslib is a transitive dependency (of roamjs-components), which pnpm does
 * not hoist where vite's import analysis can see it — resolve it through
 * roamjs-components' own require chain instead. */
const requireHere = createRequire(import.meta.url);
const requireFromRjc = createRequire(
  requireHere.resolve("roamjs-components/package.json"),
);

const DIST = join(process.cwd(), "dist", "extension.js");

describe.skipIf(!existsSync(DIST))("built bundle (roam/js load path)", () => {
  afterEach(() => {
    document.getElementById("hover-key-figure-style")?.remove();
    document.querySelector(".hkf-chip")?.remove();
  });

  it("loads with extensionAPI undefined, installs style and chip, unloads clean", async () => {
    // window.React etc. carry real global types; the stubs go in through a
    // plain record on purpose.
    const w = window as unknown as Record<string, unknown>;
    w.TSLib = requireFromRjc("tslib");
    w.React = {};
    w.ReactDOM = {};
    w.Nanoid = { nanoid: () => "xxxxxxxxx" };
    w.RoamLazy = undefined;
    w.Blueprint = {
      Core: { Toaster: { create: () => ({ show: () => "", dismiss: () => "" }) } },
    };
    w.roamAlphaAPI = {
      data: {
        async: {
          q: async () => [],
          pull: async () => null,
        },
      },
      ui: {
        commandPalette: { addCommand: () => "", removeCommand: () => "" },
      },
      platform: {},
    };

    const mod = (await import(/* @vite-ignore */ pathToFileURL(DIST).href)) as {
      default: {
        onload: (args: unknown) => unknown;
        onunload?: () => unknown;
      };
    };
    expect(typeof mod.default?.onload).toBe("function");

    await mod.default.onload({
      extensionAPI: undefined,
      extension: { version: "roam/js" },
    });

    // runExtension does not chain the async run body's promise, so wait for
    // its last visible effect rather than asserting synchronously.
    await vi.waitFor(() => {
      expect(document.getElementById("hover-key-figure-style")).not.toBeNull();
      expect(document.querySelector(".hkf-chip")).not.toBeNull();
    });

    await mod.default.onunload?.();
    expect(document.getElementById("hover-key-figure-style")).toBeNull();
    expect(document.querySelector(".hkf-chip")).toBeNull();
  });
});
