/* Load the BUILT bundle the way a roam/js block does.
 *
 * The interop bug this guards against (see interop.spec.ts) is invisible to
 * unit tests, because vitest resolves CommonJS with ordinary interop; only
 * the esbuild-built bundle has the broken `{ default: fn }` shape. So this
 * spec imports dist/extension.js into jsdom with the host globals stubbed,
 * runs onload exactly as the roam/js loader block does (extensionAPI
 * undefined), and asserts the console surface appears and unloads.
 *
 * Skips when dist/ has not been built yet: run `pnpm build` first.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { installFakeRoam } from "./fixtures";

const BUNDLE = join(process.cwd(), "dist", "extension.js");
const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

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
    w.React = {};
    w.ReactDOM = {};
    w.Blueprint = anyProxy();
    w.RoamLazy = anyProxy();
    w.TSLib = anyProxy();
    w.Nanoid = anyProxy();
    installFakeRoam({ me: "Tester" });
    cleanup.push(() => {
      for (const k of ["React", "ReactDOM", "Blueprint", "RoamLazy", "TSLib", "Nanoid", "roamAlphaAPI"])
        delete w[k];
    });

    const module = await import(/* @vite-ignore */ BUNDLE);
    const extension = module.default;
    expect(typeof extension?.onload).toBe("function");

    // Exactly what the roam/js loader block passes. runExtension's onload
    // returns void, not the load promise, so wait for identity to resolve.
    extension.onload({ extensionAPI: undefined, extension: { version: "roam/js" } });
    await vi.waitFor(() => expect(w.roamInbox?.debug().me).toBe("Tester"));

    expect(w.roamInbox.version).toBe(version);
    expect(document.getElementById("roam-inbox-style")).toBeTruthy();

    if (typeof extension.onunload === "function") await extension.onunload();
    else w.roamInbox.unload();
    expect(w.roamInbox).toBeUndefined();
    expect(document.getElementById("roam-inbox-style")).toBeNull();
  });
});
