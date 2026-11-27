/* copy-for-latex — copy a discourse node as a LaTeX sentence with its citation.
 *
 * Spec: SPEC.md
 */
import { render as renderToast } from "roamjs-components/components/Toast";
import { runExtension } from "roamjs-components/util";
import { loadNodeTypes } from "~/graph";
import { startObserver } from "~/dom";
import { handleContextMenu, handleKeydown, handlePointer } from "~/contextMenu";
import { closeMenu } from "~/menu";
import { MENU_CSS } from "~/styles";

/* Inject the menu's stylesheet.
 *
 * Deliberately not roamjs-components' addStyle, which is a default export.
 * This repository builds with esbuild in ESM format, and its __toESM helper
 * runs in Node-interop mode: a default import of a CommonJS module resolves
 * to the whole module object, so `addStyle` arrives as `{ default: fn }` and
 * calling it throws "is not a function". roamjs-components is CommonJS, so
 * every default import from it has this shape. Named imports are unaffected,
 * which is why the template's `{ render }` and `{ runExtension }` work.
 *
 * Six lines is cheaper than depending on that interop staying as it is. */
const injectStyle = (css: string): HTMLStyleElement => {
  const el = document.createElement("style");
  el.id = "copy-for-latex-style";
  el.textContent = css;
  document.head.appendChild(el);
  return el;
};

/* What this extension needs from Roam, checked before anything else so a
 * missing capability reports itself by name instead of as a TypeError deep in
 * a helper. */
const missingCapability = (): string => {
  const api = window.roamAlphaAPI as unknown as Record<string, unknown> | undefined;
  if (!api) return "window.roamAlphaAPI is not available";
  const data = api.data as { async?: { q?: unknown } } | undefined;
  if (typeof data?.async?.q !== "function")
    return "window.roamAlphaAPI.data.async.q is not available in this Roam build";
  return "";
};

/* Report a load failure loudly, and never rethrow.
 *
 * runExtension's own failure path cannot be relied on. In production it does
 * not log the error at all: it posts the message to SamePage and shows a
 * generic "Failed to load" toast. Worse, it reads
 * `args.extensionAPI.settings.getAll()` while doing so, and `extensionAPI` is
 * undefined whenever the module is loaded by `import()` from a roam/js block
 * rather than by Roam itself. The reporter then throws its own TypeError on
 * top of ours, and the original error is lost entirely. That is exactly how
 * this presented in real use: an unexplained "Cannot read properties of
 * undefined (reading 'settings')" and no trace of the actual cause.
 *
 * So the error is caught here, where the message still exists. */
const reportLoadFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  // Console first, and unconditionally. The toast depends on Blueprint and a
  // lazily-loaded Roam global, so it can throw on its own; if it did so from
  // here the original error would be lost again, which is the exact failure
  // this function exists to prevent.
  console.error("copy-for-latex failed to load:", error);
  try {
    renderToast({
      id: "copy-for-latex-load-failure",
      content: `Copy for LaTeX failed to load: ${message}`,
      intent: "danger",
      timeout: 0,
    });
  } catch (toastError) {
    console.error("copy-for-latex: the failure toast also failed:", toastError);
  }
};

export default runExtension(async () => {
  try {
    const missing = missingCapability();
    if (missing) throw new Error(missing);

    /* Injected here rather than left to a published extension.css, which Roam
     * only injects on the URL-loading path. See src/styles.ts. */
    const style = injectStyle(MENU_CSS);

    await loadNodeTypes();
    const observer = startObserver();

    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("mousedown", handlePointer, true);
    document.addEventListener("click", handlePointer, true);
    document.addEventListener("keydown", handleKeydown);

    return {
      unload: () => {
        document.removeEventListener("contextmenu", handleContextMenu, true);
        document.removeEventListener("mousedown", handlePointer, true);
        document.removeEventListener("click", handlePointer, true);
        document.removeEventListener("keydown", handleKeydown);
        observer.disconnect();
        closeMenu();
        style.remove();
      },
    };
  } catch (error) {
    reportLoadFailure(error);
    return {};
  }
});
