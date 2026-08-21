/* properties-panel — a lens over #.properties blocks.
 *
 * Renders the `#.properties` block on discourse-node pages as a structured
 * panel: filled slots as chips, unfilled slots as ghost "+ add" affordances,
 * vocabulary-backed selects and multi-selects driven by the
 * [[roam/js/attribute-select]] registry, plus a title-level actions row.
 *
 * THE BLOCKS REMAIN THE ONLY STORE. Every edit this panel makes is a plain
 * text block write in canonical form; "view as blocks" reveals the native
 * subtree at any time. Drift (out-of-vocabulary values) is flagged, never
 * auto-repaired.
 *
 * Ported from the roam/js prototype (DiscourseGraphs/dg-properties-panel,
 * extension.js v0.4.2). Spec: SPEC.md.
 */
import { render as renderToast } from "roamjs-components/components/Toast";
import { runExtension } from "roamjs-components/util";
import * as coreModule from "~/core";
import { CONFIG, VERSION } from "~/config";
import { clearCaches } from "~/graph";
import { mountForCurrentPage, registerAction, unmountAll } from "~/mount";
import { PANEL_CSS } from "~/styles";

/* Inject the panel's stylesheet.
 *
 * Deliberately not roamjs-components' addStyle, which is a default export.
 * This repository builds with esbuild in ESM format, and its __toESM helper
 * runs in Node-interop mode: a default import of a CommonJS module resolves
 * to the whole module object, so `addStyle` arrives as `{ default: fn }` and
 * calling it throws "is not a function". roamjs-components is CommonJS, so
 * every default import from it has this shape (copy-for-latex shipped the
 * same bug; tests/interop.spec.ts guards the source). Named imports are
 * unaffected. */
const injectStyle = (css: string): HTMLStyleElement => {
  const el = document.createElement("style");
  el.id = "dg-props-panel-css";
  el.textContent = css;
  document.head.appendChild(el);
  return el;
};

/* What this extension needs from Roam, checked before anything else so a
 * missing capability reports itself by name instead of as a TypeError deep
 * in a helper. */
const missingCapability = (): string => {
  const api = (window as any).roamAlphaAPI;
  if (!api) return "window.roamAlphaAPI is not available";
  if (typeof api.data?.async?.q !== "function")
    return "window.roamAlphaAPI.data.async.q is not available in this Roam build";
  if (!(window as any).React || !(window as any).ReactDOM)
    return "window.React / window.ReactDOM are not available";
  return "";
};

/* Report a load failure loudly, and never rethrow.
 *
 * runExtension's own failure path cannot be relied on: in production it does
 * not log the error, and it reads `args.extensionAPI.settings.getAll()`
 * while reporting — undefined whenever the module is loaded by `import()`
 * from a roam/js block rather than by Roam itself, so its reporter throws
 * "Cannot read properties of undefined (reading 'settings')" over the top of
 * the real error. The console gets the error first and unconditionally; the
 * toast (which needs Blueprint and can throw on its own) is attempted
 * separately. */
const reportLoadFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("properties-panel failed to load:", error);
  try {
    renderToast({
      id: "properties-panel-load-failure",
      content: `Properties Panel failed to load: ${message}`,
      intent: "danger",
      timeout: 0,
    });
  } catch (toastError) {
    /* already on the console */
  }
};

export default runExtension(async () => {
  try {
    const missing = missingCapability();
    if (missing) throw new Error(missing);

    // A previous instance (e.g. the roam/js-block build of the prototype)
    // unloads first, so the two install paths can't double-mount.
    const prev = (window as any).dgPropsPanel;
    if (prev && typeof prev.unload === "function") {
      try {
        prev.unload();
      } catch (e) {
        /* stale instance; ignore */
      }
    }

    /* Injected here rather than left to a published extension.css, which
     * Roam only injects on the URL-loading path. See src/styles.ts. */
    const style = injectStyle(PANEL_CSS);

    const onNav = () => setTimeout(mountForCurrentPage, 120);
    window.addEventListener("hashchange", onNav);
    const pollTimer = window.setInterval(mountForCurrentPage, CONFIG.pollMs);
    onNav();

    // The public surface other extensions build on (the Linear-Roam sync
    // extension registers into the "linear" action slot). Kept identical to
    // the roam/js prototype's contract.
    (window as any).dgPropsPanel = {
      VERSION,
      _core: coreModule,
      config: CONFIG,
      refresh: mountForCurrentPage,
      registerAction,
      unload: () => {
        window.removeEventListener("hashchange", onNav);
        clearInterval(pollTimer);
        unmountAll();
        style.remove();
        clearCaches();
        delete (window as any).dgPropsPanel;
      },
    };

    // Registrations live on THIS instance — tell registrars (e.g. Linear-Roam
    // sync) to (re)register every time the panel loads.
    document.dispatchEvent(
      new CustomEvent("dgpp:ready", { detail: { version: VERSION } }),
    );

    console.log(`properties-panel v${VERSION} loaded`);

    return {
      unload: () => {
        const self = (window as any).dgPropsPanel;
        if (self && typeof self.unload === "function") self.unload();
      },
    };
  } catch (error) {
    reportLoadFailure(error);
    return {};
  }
});
