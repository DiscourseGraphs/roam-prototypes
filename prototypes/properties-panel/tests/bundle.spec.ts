/* Load the BUILT bundle the way a roam/js block does.
 *
 * The interop bug this guards against (see interop.spec.ts) is invisible to
 * unit tests because vitest resolves CommonJS with ordinary interop — only
 * the esbuild-built bundle has the broken `{ default: fn }` shape. So this
 * spec imports dist/extension.js into jsdom with the host globals stubbed,
 * runs onload exactly as the roam/js loader block does (extensionAPI
 * undefined), and asserts the panel's public surface appears and unloads.
 *
 * Skips when dist/ hasn't been built yet (run `pnpm build` first; CI builds
 * after tests, so this is a local/pre-push guard more than a CI one).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VERSION } from "~/config";

const BUNDLE = join(process.cwd(), "dist", "extension.js");

/* Permissive stand-in for host libraries the bundle destructures lazily
 * (Blueprint, RoamLazy, …): any property access or call yields another
 * proxy, so module-scope destructuring never throws. */
const anyProxy = (): any =>
  new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : anyProxy()),
    set: () => true,
    apply: () => anyProxy(),
    construct: () => anyProxy(),
  });

describe.skipIf(!existsSync(BUNDLE))("built bundle", () => {
  const w = window as any;
  const cleanup: (() => void)[] = [];
  afterAll(() => cleanup.forEach((fn) => fn()));

  it("loads via import(), onloads with extensionAPI undefined, and unloads", async () => {
    // Host globals the esbuild host-globals plugin maps modules onto.
    w.React = {}; // capability-checked; only touched at render, not at load
    w.ReactDOM = {};
    w.Blueprint = anyProxy();
    w.RoamLazy = anyProxy();
    w.TSLib = anyProxy();
    w.Nanoid = anyProxy();
    w.roamAlphaAPI = {
      data: { async: { q: async () => [], pull: async () => null } },
      ui: { mainWindow: { getOpenPageOrBlockUid: async () => null } },
      util: { generateUID: () => "test-uid" },
    };
    cleanup.push(() => {
      for (const k of ["React", "ReactDOM", "Blueprint", "RoamLazy", "TSLib", "Nanoid", "roamAlphaAPI"])
        delete w[k];
    });

    const module = await import(/* @vite-ignore */ BUNDLE);
    const extension = module.default;
    expect(typeof extension?.onload).toBe("function");

    // Exactly what the roam/js loader block passes.
    await extension.onload({ extensionAPI: undefined, extension: { version: "roam/js" } });

    // The load either succeeded (public surface present) or was swallowed by
    // a failure reporter — make silent failure impossible to miss here.
    expect(w.dgPropsPanel, "panel did not load — check console for the reported cause").toBeTruthy();
    expect(w.dgPropsPanel.VERSION).toBe(VERSION);
    expect(document.getElementById("dg-props-panel-css")).toBeTruthy();

    if (typeof extension.onunload === "function") await extension.onunload();
    else w.dgPropsPanel.unload();
    expect(w.dgPropsPanel).toBeUndefined();
    expect(document.getElementById("dg-props-panel-css")).toBeNull();
  });
});
