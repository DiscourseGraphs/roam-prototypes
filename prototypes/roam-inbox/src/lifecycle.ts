/* Load, unload, and the `window.roamInbox` console surface. index.ts wraps
 * this in runExtension; tests call it directly. */
import { startBadge, stopBadge } from "~/badge";
import { LOG, logError, VERSION } from "~/config";
import { loadSeen, myAddress, refreshLists, resetInbox, setIdentity, state, unreadMessages } from "~/inbox";
import { isWatching, startWatching, stopWatching } from "~/live";
import { resetMembers, warmMembers } from "~/members";
import { closePanel } from "~/panel";
import { closePicker, registerMessageCommand } from "~/picker";
import { currentUser, ensurePage } from "~/roam";
import { injectStyle, removeStyle } from "~/styles";
import { prettify } from "~/text";
import { startToasts, stopToasts } from "~/toast";
import { hideTip } from "~/tooltip";

declare global {
  interface Window {
    roamInbox?: {
      version: string;
      unload: () => void;
      refresh: () => Promise<void>;
      debug: () => Record<string, unknown>;
    };
  }
}

let disposeSlash: (() => void) | null = null;
// Bumped by unload so a load still waiting on the graph abandons its
// remaining steps instead of mounting into an unloaded page.
let session = 0;

/* One object that says which build is running and why the badge looks the
 * way it does, so "it's still grey" is a fact rather than a guess. Reads the
 * current state; `await roamInbox.refresh()` first to re-query. */
export const debug = (): Record<string, unknown> => {
  const unread = unreadMessages();
  const newest = state.messages[0];
  const me = state.me;
  return {
    version: VERSION,
    me: me?.name ?? null,
    watching: me?.address ?? null,
    pullWatchActive: isWatching(),
    counts: {
      messages: state.messages.length,
      mentions: state.mentions.length,
      tasks: state.tasks.length,
    },
    badge: unread.length ? `blue ${unread.length}` : state.messages.length ? "grey dot" : "hidden",
    unreadCount: unread.length,
    // How many uids you have acknowledged. `blockCreated` is the block's
    // birthday, NOT when it was addressed to you; see inbox.ts.
    seenCount: me ? loadSeen().size : 0,
    newestMessage: newest
      ? {
          blockCreated: new Date(newest.time).toISOString(),
          unread: !loadSeen().has(newest.uid),
          from: newest.author,
          text: prettify(newest.string, myAddress()).slice(0, 60),
        }
      : null,
    hint: unread.length
      ? "ok"
      : state.messages.length
        ? "grey dot is correct: every open message is already acknowledged"
        : "inbox empty",
  };
};

export const unload = (): void => {
  session += 1;
  closePicker();
  closePanel();
  hideTip();
  try {
    disposeSlash?.();
  } catch {
    /* already gone */
  }
  disposeSlash = null;
  stopWatching();
  stopBadge();
  stopToasts();
  removeStyle();
  resetMembers();
  resetInbox();
  if (window.roamInbox?.unload === unload) delete window.roamInbox;
};

export const load = async (): Promise<void> => {
  const mine = ++session;
  window.roamInbox = { version: VERSION, unload, refresh: refreshLists, debug };
  injectStyle();
  disposeSlash = registerMessageCommand();
  if (!disposeSlash) console.warn(`${LOG} this Roam build has no slash-command API; /message is disabled`);
  warmMembers();

  const identity = await currentUser().catch((e) => {
    logError("identity lookup failed", e);
    return null;
  });
  if (mine !== session) return;
  if (!identity) {
    console.warn(`${LOG} no display page for the current user: /message works, inbox badge disabled`);
    return;
  }
  const me = setIdentity(identity);
  await Promise.all([
    ensurePage(me.address).catch((e) => logError(`could not create ${me.address}`, e)),
    refreshLists(),
  ]);
  if (mine !== session) return;

  startToasts();
  startBadge();
  startWatching();
  console.log(
    `${LOG} v${VERSION} ready for ${me.name}: ${state.messages.length} open, ` +
      `${unreadMessages().length} new. roamInbox.debug() for details.`,
  );
};
