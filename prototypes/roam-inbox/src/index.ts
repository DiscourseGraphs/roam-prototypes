/* roam-inbox: in-graph messaging for Roam Research, with a signal.
 *
 * Two halves of one feature, deliberately shipped together:
 *
 *   SEND     "/message" registers a "Send message" command in Roam's native
 *            slash menu. Picking a person inserts `{{[[TODO]]}} [[+Name]] `,
 *            matching [[Convention/Inbox]] verbatim.            (picker.ts)
 *
 *   RECEIVE  A topbar badge counts messages addressed to you that arrived
 *            since you last opened the panel. Clicking it opens an inbox
 *            panel (Messages / Mentions / Tasks) with open-in-sidebar,
 *            reply, and check-off on every row.       (badge.ts, panel.ts)
 *
 * Read is separate from done: the badge tracks what is new since you last
 * looked, the {{[[TODO]]}} checkbox keeps meaning "handled".   (inbox.ts)
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
  const data = api.data as { async?: { q?: unknown } } | undefined;
  if (typeof data?.async?.q !== "function")
    return "window.roamAlphaAPI.data.async.q is not available in this Roam build";
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
      id: "roam-inbox-load-failure",
      content: `Roam Inbox failed to load: ${message}`,
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
    await load();
    return { unload };
  } catch (error) {
    reportLoadFailure(error);
    unload();
    return {};
  }
});
