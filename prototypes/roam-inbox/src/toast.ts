/* "X messaged you" toasts for messages that arrive while you are here. */
import { TOAST_MAX, TOAST_MS } from "~/config";
import { el } from "~/dom";
import { myAddress, state, subscribe, unreadMessages } from "~/inbox";
import { togglePanel } from "~/panel";
import type { Message } from "~/roam";
import { prettify } from "~/text";

let host: HTMLDivElement | null = null;
let unsubscribe: (() => void) | null = null;

/* Uids that have already had their toast, so an edit to a message does not
 * announce it twice. */
const toasted = new Set<string>();

const showToast = (row: Message): void => {
  if (!host || !document.body.contains(host)) {
    host = el("div", "rmi-toasts");
    document.body.appendChild(host);
  }
  const toast = el("div", "rmi-toast");
  toast.appendChild(el("div", "rmi-toast-who", `${row.author || "Someone"} messaged you`));
  toast.appendChild(
    el("div", "rmi-toast-body", prettify(row.string, myAddress()) || "(no text)"),
  );
  toast.addEventListener("click", () => {
    toast.remove();
    togglePanel();
  });
  host.appendChild(toast);
  setTimeout(() => toast.remove(), TOAST_MS);
};

const announce = (): void => {
  unreadMessages()
    .filter((m) => !toasted.has(m.uid))
    // No toast for a note you just typed to yourself: you are looking straight
    // at it. It still counts toward the badge.
    .filter((m) => m.authorUid !== state.me?.uid)
    .slice(0, TOAST_MAX)
    .forEach((m) => {
      toasted.add(m.uid);
      showToast(m);
    });
};

/* Everything already in the inbox at load is "not new to this session". */
export const startToasts = (): void => {
  unreadMessages().forEach((m) => toasted.add(m.uid));
  unsubscribe = subscribe(announce);
};

export const stopToasts = (): void => {
  unsubscribe?.();
  unsubscribe = null;
  host?.remove();
  host = null;
  toasted.clear();
};
