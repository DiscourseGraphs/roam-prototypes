/* The topbar icon and its count. Subscribes to the inbox and repaints
 * itself; never queries. */
import { BADGE_ID, INBOX_SVG, MOUNT_RETRY_MS } from "~/config";
import { el } from "~/dom";
import { state, subscribe, unreadMessages } from "~/inbox";
import { togglePanel } from "~/panel";
import { attachTooltip } from "~/tooltip";

const openMessages = (n: number): string => `${n} open message${n === 1 ? "" : "s"}`;

const badgeTooltip = (): string => {
  const n = unreadMessages().length;
  const open = state.messages.length;
  if (n) return `${n} new · ${openMessages(open)}`;
  if (open) return `Inbox — ${openMessages(open)}, nothing new`;
  return "Inbox — all clear";
};

const renderBadge = (): void => {
  const btn = document.getElementById(BADGE_ID);
  if (!btn) return;
  const glyph = btn.querySelector(".rmi-glyph") || btn;
  const n = unreadMessages().length;
  const open = state.messages.length;
  let bubble = btn.querySelector(".rmi-count");
  if (n > 0 || open > 0) {
    if (!bubble) {
      bubble = document.createElement("span");
      glyph.appendChild(bubble); // anchored to the glyph, not the button
    }
    // A number only for what is actually new. A permanent count of everything
    // open is the failure mode this whole design avoids: it stops being a
    // signal. But a silent icon over a 25-message backlog is not discoverable
    // either, so "non-empty" gets a muted dot.
    bubble.className = n > 0 ? "rmi-count" : "rmi-count rmi-dot";
    bubble.textContent = n > 0 ? (n > 99 ? "99+" : String(n)) : "";
  } else {
    bubble?.remove();
  }
};

const mount = (topbar: Element): void => {
  // Blueprint classes so it inherits Roam's own topbar button styling. The
  // icon lives on an inner span rather than on the button, so the badge has
  // a fixed-size element to anchor to (see .rmi-glyph in the CSS).
  const btn = el("span", "bp3-button bp3-minimal bp3-small pointer rmi-btn");
  btn.id = BADGE_ID;
  // `bp3-icon` alone still buys Blueprint's icon colour inheritance; the
  // glyph itself is the inline SVG (see INBOX_SVG for why).
  const glyph = el("span", "bp3-icon rmi-glyph");
  glyph.innerHTML = INBOX_SVG;
  btn.appendChild(glyph);
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePanel();
  });
  attachTooltip(btn, badgeTooltip);

  const anchor = topbar.querySelector(".rm-find-or-create-wrapper");
  if (anchor && anchor.parentElement === topbar) anchor.insertAdjacentElement("afterend", btn);
  else topbar.appendChild(btn);
  renderBadge();
};

let observer: MutationObserver | null = null;
let retryTimer: number | null = null;
let unsubscribe: (() => void) | null = null;

/* Mount into `.rm-topbar` after the search box if not already there, and
 * watch for the topbar being replaced. Idempotent, so it is safe to call
 * from every place that might notice the badge missing. False only while
 * the topbar is not rendered yet. */
const ensureBadge = (): boolean => {
  const topbar = document.querySelector(".rm-topbar");
  if (!topbar) return false;
  // Deliberately NOT `observe(document.body, {subtree: true})`. That is the
  // busiest node in the app: it fires on every keystroke, every block render,
  // every sidebar update. Measured against a real page navigation, the topbar
  // was not replaced at all, so the expensive watch buys almost nothing.
  // Watching only the topbar's direct parent with subtree:false fires solely
  // when the topbar element itself is swapped, which is the only case that
  // can orphan the badge. Every inbox refresh re-checks the mount as a
  // backstop, so even a missed mutation self-heals within POLL_MS.
  if (!observer && topbar.parentElement) {
    observer = new MutationObserver(() => ensureBadge());
    observer.observe(topbar.parentElement, { childList: true, subtree: false });
  }
  if (!document.getElementById(BADGE_ID)) mount(topbar);
  return true;
};

export const startBadge = (): void => {
  unsubscribe = subscribe(() => {
    ensureBadge();
    renderBadge();
  });
  if (!ensureBadge()) {
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      ensureBadge();
    }, MOUNT_RETRY_MS);
  }
};

export const stopBadge = (): void => {
  unsubscribe?.();
  unsubscribe = null;
  observer?.disconnect();
  observer = null;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  document.getElementById(BADGE_ID)?.remove();
};
