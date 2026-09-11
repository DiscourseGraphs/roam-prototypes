/* The inbox panel: Messages / Mentions / Tasks, with Open, Reply, and Done
 * on every row. Opens under the badge and repaints itself on every inbox
 * change while open. */
import { markDone, open, replyTo } from "~/actions";
import { BADGE_ID, logError } from "~/config";
import { el, onPress } from "~/dom";
import { loadSeen, markSeen, myAddress, refreshLists, state, subscribe, unreadMessages } from "~/inbox";
import { prettify, relTime } from "~/text";
import { attachTooltip } from "~/tooltip";

type Tab = "messages" | "mentions" | "tasks";

const TABS: [Tab, string][] = [
  ["messages", "Messages"],
  ["mentions", "Mentions"],
  ["tasks", "Tasks"],
];

const EMPTY: Record<Tab, string> = {
  messages: "No open messages. 🎉",
  mentions: "No mentions.",
  tasks: "No open tasks.",
};

const FOOT: Record<Tab, string> = {
  messages: "[[+you]] — addressed to you · /message to send",
  mentions: "[[+you]] with no checkbox — FYI, never badges",
  tasks: "#[[you]] — assigned work, from /task",
};

let tab: Tab = "messages";
let panelEl: HTMLDivElement | null = null;
let panelCleanup: (() => void) | null = null;
// Unread snapshot taken as the panel opens, so the blue "new" marks survive
// the acknowledgement that opening the panel performs.
let panelNew = new Set<string>();

export const closePanel = (): void => {
  const fn = panelCleanup;
  panelCleanup = null;
  fn?.();
};

const refresh = (): void => {
  void refreshLists().catch((e) => logError("refresh failed", e));
};

const renderPanel = (): void => {
  if (!panelEl) return;
  panelEl.innerHTML = "";
  const address = myAddress();

  const tabs = el("div", "rmi-tabs");
  for (const [key, label] of TABS) {
    const n = state[key].length;
    const t = el("div", "rmi-tab" + (tab === key ? " rmi-tab-on" : ""), n ? `${label} ${n}` : label);
    onPress(t, () => {
      tab = key;
      renderPanel();
    });
    tabs.appendChild(t);
  }
  panelEl.appendChild(tabs);

  const list = el("div", "rmi-list");
  const rows = state[tab];
  if (!rows.length) list.appendChild(el("div", "rmi-empty", EMPTY[tab]));

  const seen = loadSeen();
  for (const row of rows) {
    // Matches the badge exactly (see unreadMessages). The second half catches
    // anything that lands while the panel is already open.
    const isNew = tab === "messages" && (panelNew.has(row.uid) || !seen.has(row.uid));
    const item = el("div", "rmi-row" + (isNew ? " rmi-new" : ""));

    const meta = el("div", "rmi-meta");
    meta.appendChild(el("span", "rmi-who", row.author || "Unknown"));
    meta.appendChild(document.createTextNode(` · ${relTime(row.time)}`));
    item.appendChild(meta);

    const text = el("div", "rmi-text", prettify(row.string, address) || "(no text)");
    onPress(text, () => open(row.uid));
    item.appendChild(text);

    // The page title needs flattening too: in a discourse graph most pages
    // are `[[ISS]] - …` / `[[QUE]] - …`, so raw titles show their brackets.
    // A top-level block's parent is its page; do not show the title twice.
    const page = prettify(row.page, address);
    const parent = row.parent === row.page ? "" : prettify(row.parent, address);
    const ctx = el("div", "rmi-ctx", [page, parent].filter(Boolean).join(" › "));
    item.appendChild(ctx);
    attachTooltip(ctx, () => ctx.textContent || "");

    const acts = el("div", "rmi-acts");
    const act = (label: string, fn: () => void) => {
      const b = el("span", "rmi-act", label);
      onPress(b, fn);
      acts.appendChild(b);
    };
    act("Open", () => open(row.uid));
    act("Reply", () => {
      closePanel();
      void replyTo(row).catch((e) => logError("reply failed", e));
    });
    if (tab !== "mentions") {
      act("✓ Done", () => {
        void markDone(row.uid)
          .then(refreshLists)
          .catch((e) => logError("check-off failed", e));
      });
    }
    item.appendChild(acts);
    list.appendChild(item);
  }
  panelEl.appendChild(list);
  panelEl.appendChild(el("div", "rmi-foot", FOOT[tab]));
};

const openPanel = (): void => {
  // Snapshot before acknowledging, so what was new stays visibly new while
  // the panel is open.
  panelNew = new Set(unreadMessages().map((m) => m.uid));
  markSeen(state.messages);

  panelEl = el("div", "rmi-panel");
  document.body.appendChild(panelEl);
  const btn = document.getElementById(BADGE_ID);
  const r = btn ? btn.getBoundingClientRect() : { bottom: 44, right: window.innerWidth - 14 };
  panelEl.style.top = `${r.bottom + 6}px`;
  panelEl.style.right = `${Math.max(8, window.innerWidth - r.right - 4)}px`;
  renderPanel();

  const onDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (panelEl && !panelEl.contains(target) && !btn?.contains(target)) closePanel();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closePanel();
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  const unsubscribe = subscribe(renderPanel);
  panelCleanup = () => {
    unsubscribe();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    panelEl?.remove();
    panelEl = null;
    panelNew = new Set();
  };

  // Opened from the current lists, which the watch and poll keep current;
  // anything that lands during this refresh repaints through the subscription.
  refresh();
};

export const togglePanel = (): void => {
  if (panelEl) closePanel();
  else openPanel();
};
