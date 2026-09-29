/* roam-meeting-tasks: the next actions carried over from past meetings, and
 * the other open tasks on a recurring-meeting page, shown inline wherever the
 * page's `{{roam/render: ((uid))}}` widget sits.
 *
 *   shim.ts       what lives in the graph's roam/render code block
 *   mount.ts      gives each widget its own React root
 *   view.tsx      what a widget displays
 *   load.ts       one widget's load: read, then derive
 *   roam.ts       every graph read and write
 *   model.ts      what to show, from data already read (pure)
 *   text.ts       string rules: markers, headers, refs, display text (pure)
 */
import { render as renderToast } from "roamjs-components/components/Toast";
import { runExtension } from "roamjs-components/util";
import { logError } from "~/config";
import { load, unload } from "~/lifecycle";

/* What this extension needs from Roam, checked before anything else so a
 * missing capability reports itself by name instead of as a TypeError deep
 * in a helper. */
const missingCapability = (): string => {
  const api = window.roamAlphaAPI as unknown as Record<string, unknown> | undefined;
  if (!api) return "window.roamAlphaAPI is not available";
  const data = api.data as { async?: { pull_many?: unknown } } | undefined;
  if (typeof data?.async?.pull_many !== "function")
    return "window.roamAlphaAPI.data.async.pull_many is not available in this Roam build";
  const w = window as unknown as { React?: unknown; ReactDOM?: unknown };
  if (!w.React || !w.ReactDOM) return "window.React / window.ReactDOM are not available";
  return "";
};

/* Report a load failure loudly, and never lose the cause.
 *
 * runExtension's own failure path cannot be relied on. In production it does
 * not log the error: it posts the message to SamePage and shows a generic
 * toast, and while doing so reads `args.extensionAPI.settings.getAll()`.
 * `extensionAPI` is undefined whenever the module is loaded by `import()`
 * from a roam/js block, so the reporter throws its own TypeError over ours
 * and the original error is gone. So the console line comes first, here. */
const reportLoadFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  logError("failed to load", error);
  try {
    renderToast({
      id: "roam-meeting-tasks-load-failure",
      content: `Meeting Tasks failed to load: ${message}`,
      intent: "danger",
      timeout: 0,
    });
  } catch (toastError) {
    logError("the failure toast also failed", toastError);
  }
};

export default runExtension(async () => {
  try {
    const missing = missingCapability();
    if (missing) throw new Error(missing);
    load();
    return { unload };
  } catch (error) {
    reportLoadFailure(error);
    unload();
    return {};
  }
});
