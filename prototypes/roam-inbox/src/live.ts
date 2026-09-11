/* Keeping the lists current: a pull watch on the `+Me` page, with a slow
 * poll as insurance. Everything that shows the lists repaints through the
 * inbox subscription. */
import { logError, POLL_MS, WATCH_DEBOUNCE_MS } from "~/config";
import { refreshLists, state } from "~/inbox";
import { watchReferencesTo } from "~/roam";

let stopWatch: (() => void) | null = null;
let pollTimer: number | null = null;
let debounceTimer: number | null = null;

const refresh = (): void => {
  void refreshLists().catch((e) => logError("refresh failed", e));
};

const scheduleRefresh = (): void => {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(refresh, WATCH_DEBOUNCE_MS);
};

// Roam tabs live in the background all day. The poll skips while the tab is
// hidden (the pull watch still fires) and runs once as soon as it is shown,
// so the badge is right before you can read it.
const onPoll = (): void => {
  if (document.visibilityState !== "hidden") refresh();
};
const onVisibility = (): void => {
  if (document.visibilityState === "visible") refresh();
};

export const isWatching = (): boolean => stopWatch !== null;

export const startWatching = (): void => {
  const me = state.me;
  if (!me) return;
  // Any new block referencing the `+Me` page changes its reverse-ref set,
  // which is what the pattern watches. The poll is insurance, not the path.
  try {
    stopWatch = watchReferencesTo(me.address, scheduleRefresh);
  } catch (e) {
    logError("pull watch failed; polling only", e);
  }
  pollTimer = window.setInterval(onPoll, POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
};

export const stopWatching = (): void => {
  try {
    stopWatch?.();
  } catch {
    /* already gone */
  }
  stopWatch = null;
  if (pollTimer !== null) clearInterval(pollTimer);
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  pollTimer = debounceTimer = null;
  document.removeEventListener("visibilitychange", onVisibility);
};
