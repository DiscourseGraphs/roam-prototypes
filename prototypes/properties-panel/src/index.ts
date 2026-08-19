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
import addStyle from "roamjs-components/dom/addStyle";
import { runExtension } from "roamjs-components/util";
import * as coreModule from "~/core";
import { CONFIG, VERSION } from "~/config";
import { clearCaches } from "~/graph";
import { mountForCurrentPage, registerAction, unmountAll } from "~/mount";
import { PANEL_CSS } from "~/styles";

export default runExtension(async () => {
  // A previous instance (e.g. the roam/js-block build) unloads first, so the
  // two install paths can't double-mount.
  const prev = (window as any).dgPropsPanel;
  if (prev && typeof prev.unload === "function") {
    try {
      prev.unload();
    } catch (e) {
      /* stale instance; ignore */
    }
  }

  /* Injected here rather than left to a published extension.css, which Roam
   * only injects on the URL-loading path. See src/styles.ts. */
  const style = addStyle(PANEL_CSS, "dg-props-panel-css");

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
  document.dispatchEvent(new CustomEvent("dgpp:ready", { detail: { version: VERSION } }));

  console.log(`properties-panel v${VERSION} loaded`);

  return {
    unload: () => {
      const self = (window as any).dgPropsPanel;
      if (self && typeof self.unload === "function") self.unload();
    },
  };
});
