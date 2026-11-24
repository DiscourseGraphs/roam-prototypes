import React from "react";
import ReactDOM from "react-dom";
import { Button } from "@blueprintjs/core";
import {
  clearDiscussionDrafts,
  DiscussionRail,
  InlineDiscussions,
} from "~/discussion-rail";
import {
  fetchDiscussions,
  DISCUSSIONS_CHANGED,
  fetchBadgeCounts,
  resolveDiscussionContext,
  type DiscussionContext,
  type DiscussionSnapshot,
} from "~/discussion-data";
import { DISCUSSION_CSS } from "~/discussion-styles";
import { logError } from "~/config";

const HOST_ID = "rmi-discussion-host";
const STYLE_ID = "rmi-discussion-style";
const PAGE_COMMAND = "Roam Inbox: Open page discussions";
const BLOCK_COMMAND = "Roam Inbox: Discuss focused block";
const CONTEXT_COMMAND = "Roam Inbox: Discuss block";

let host: HTMLDivElement | null = null;
let layout: HTMLElement | null = null;
let context: DiscussionContext | null = null;
let observer: MutationObserver | null = null;
let panelResize: ResizeObserver | null = null;
let badgeTimer: number | undefined;
let inline: {
  uid: string;
  mount: HTMLElement;
  trigger: HTMLElement;
} | null = null;
let refreshTimer: number | undefined;
let refreshSequence = 0;
let sequence = 0;
let generation = 0;
let disposeCommands: (() => void)[] = [];
let counts = new Map<string, number>();
let inlineError = "";
let returnFocus: HTMLElement | null = null;
let visiblePageUid: string | undefined;
let snapshot: DiscussionSnapshot = { sources: [], threads: [] };
type Badge = { uid: string; mount: HTMLElement; count: number };
const badges = new Map<HTMLElement, Badge>();

const removeBadge = (row: HTMLElement): void => {
  const badge = badges.get(row);
  if (!badge) return;
  if (inline && badge.mount.contains(inline.trigger)) closeInline();
  ReactDOM.unmountComponentAtNode(badge.mount);
  badge.mount.remove();
  badges.delete(row);
};

const closeInline = (): void => {
  if (!inline) return;
  ReactDOM.unmountComponentAtNode(inline.mount);
  inline.mount.remove();
  inline = null;
};

const rememberSnapshot = (next: DiscussionSnapshot): void => {
  snapshot = next;
  counts = new Map();
  for (const { source } of next.threads)
    counts.set(source.uid, (counts.get(source.uid) || 0) + 1);
};

const dismissInline = (): void => {
  const trigger = inline?.trigger;
  closeInline();
  reconcileBadges();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
};

const refreshInline = async (): Promise<void> => {
  if (host) window.dispatchEvent(new Event(DISCUSSIONS_CHANGED));
  else await refreshPage();
};

const renderInline = (): void => {
  if (!inline) return;
  const { uid, mount } = inline;
  const threads = snapshot.threads.filter((t) => t.source.uid === uid);
  if (!mount.isConnected || !counts.has(uid)) {
    closeInline();
    return;
  }
  ReactDOM.render(
    <>
      {inlineError && (
        <div role="alert" className="rmi-discussion-error">
          {inlineError}{" "}
          <Button
            minimal
            small
            text="Retry"
            onClick={() => void refreshPage()}
          />
        </div>
      )}
      {threads.length ? (
        <InlineDiscussions
          threads={threads}
          reload={refreshInline}
          onClose={dismissInline}
          onOpenPage={() => openSafely(uid, inline?.trigger)}
        />
      ) : (
        <div className="rmi-inline-loading">
          {!inlineError && <span role="status">Loading discussions…</span>}
          <Button
            minimal
            small
            icon="cross"
            aria-label="Close block discussions"
            onClick={dismissInline}
          />
        </div>
      )}
    </>,
    mount,
  );
};

const toggleInline = (uid: string, trigger: HTMLElement): void => {
  const closing = inline?.trigger === trigger;
  sequence += 1;
  closeInline();
  if (!closing) {
    const mount = document.createElement("div");
    mount.className = "rmi-discussion-inline";
    trigger.closest(".rm-block-main")?.after(mount);
    inline = { uid, mount, trigger };
    inlineError = "";
    renderInline();
    void refreshPage();
  }
  reconcileBadges();
};

const renderBadge = (badge: Badge, count: number): void => {
  const { uid } = badge;
  const expanded = Boolean(inline && badge.mount.contains(inline.trigger));
  const target = host ? HOST_ID : undefined;
  const current = host && context?.sourceUid === uid ? "true" : null;
  const button = badge.mount.querySelector("button");
  const hint = host
    ? "Show this block in the open discussion panel."
    : "Click to show comments inline. Shift-click for page discussions.";
  if (
    badge.count === count &&
    button?.title === hint &&
    button.getAttribute("aria-current") === current &&
    button.getAttribute("aria-expanded") === String(expanded)
  )
    return;
  badge.count = count;
  ReactDOM.render(
    <Button
      minimal
      small
      rightIcon="chat"
      text={String(count)}
      aria-label={`${count} ${count === 1 ? "discussion" : "discussions"} on this block`}
      aria-expanded={expanded}
      aria-controls={target}
      aria-current={current ?? undefined}
      title={hint}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (host || event.shiftKey) openSafely(uid, event.currentTarget);
        else toggleInline(uid, event.currentTarget);
      }}
    />,
    badge.mount,
  );
};

const reconcileBadges = (): void => {
  for (const [row, badge] of badges) {
    const input = row.querySelector(
      ":scope > .rm-block__input, :scope > .rm-block-text",
    );
    if (
      !badge.mount.isConnected ||
      !counts.has(badge.uid) ||
      !input?.id.endsWith(badge.uid)
    )
      removeBadge(row);
  }
  if (!counts.size) return;
  // Roam prefixes input IDs with the render location. Imported block UIDs can vary in length.
  const lengths = Array.from(
    new Set(Array.from(counts.keys(), (uid) => uid.length)),
  ).sort((a, b) => b - a);
  const inputs = document.querySelectorAll<HTMLElement>(
    ".roam-article .rm-block-text[id], .roam-article .rm-block__input[id]",
  );
  inputs.forEach((input) => {
    const length = lengths.find(
      (size) =>
        counts.has(input.id.slice(-size)) &&
        (input.id.length === size ||
          input.id.charAt(input.id.length - size - 1) === "-"),
    );
    if (length === undefined) return;
    const uid = input.id.slice(-length);
    const row = input.closest<HTMLElement>(".rm-block-main");
    if (!row) return;
    let badge = badges.get(row);
    if (badge && badge.uid !== uid) {
      removeBadge(row);
      badge = undefined;
    }
    if (!badge) {
      const mount = document.createElement("span");
      mount.className = "rmi-discussion-badge";
      row.append(mount);
      badge = { uid, mount, count: -1 };
      badges.set(row, badge);
    }
    renderBadge(badge, counts.get(uid)!);
  });
};

const scheduleBadges = (): void => {
  if (badgeTimer !== undefined) return;
  badgeTimer = window.setTimeout(() => {
    badgeTimer = undefined;
    if (host && !host.isConnected) {
      closeDiscussions();
      refreshVisiblePage();
    }
    if (inline && !inline.mount.isConnected) closeInline();
    reconcileBadges();
  }, 100);
};

const alignBadgesBesidePanel = (
  parent: HTMLElement,
  panel: HTMLElement,
): void => {
  const wrapper = parent.querySelector<HTMLElement>(".rm-article-wrapper");
  if (!wrapper) return;
  const align = (): void => {
    // Sticky row controls use the scrollport's content edge, inside Roam's page margins.
    const padding = parseFloat(getComputedStyle(wrapper).paddingRight) || 0;
    const contentRight =
      wrapper.getBoundingClientRect().left +
      wrapper.clientLeft +
      wrapper.clientWidth -
      padding;
    const inset = Math.max(
      0,
      contentRight - panel.getBoundingClientRect().left + 8,
    );
    parent.style.setProperty("--rmi-badge-inset", `${inset}px`);
  };
  align();
  if (typeof ResizeObserver !== "undefined") {
    panelResize = new ResizeObserver(align);
    panelResize.observe(wrapper);
    panelResize.observe(parent);
    panelResize.observe(panel);
  }
};

export const closeDiscussions = (): void => {
  sequence += 1;
  if (host) {
    ReactDOM.unmountComponentAtNode(host);
    host.remove();
  }
  host = null;
  context = null;
  panelResize?.disconnect();
  panelResize = null;
  layout?.style.removeProperty("--rmi-badge-inset");
  layout?.classList.remove("rmi-discussion-layout");
  layout = null;
};

const dismissRail = (): void => {
  const trigger = returnFocus;
  closeDiscussions();
  returnFocus = null;
  reconcileBadges();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  refreshVisiblePage();
};

const renderRail = (): void => {
  if (!host || !context) return;
  const pageUid = context.pageUid;
  ReactDOM.render(
    <DiscussionRail
      key={context.pageUid}
      context={context}
      onClose={dismissRail}
      onSnapshot={(next) => {
        if (pageUid !== visiblePageUid) return;
        refreshSequence += 1;
        rememberSnapshot(next);
        renderInline();
        scheduleBadges();
      }}
    />,
    host,
  );
};

export const openDiscussions = async (
  sourceUid?: string,
  trigger?: HTMLElement,
): Promise<void> => {
  const mine = ++sequence;
  const owner = generation;
  const next = await resolveDiscussionContext(sourceUid);
  if (mine !== sequence || owner !== generation) return;
  const parent = document.querySelector<HTMLElement>(".roam-body-main");
  if (!parent) throw new Error("Roam’s main page is not available yet.");
  if (host && (!host.isConnected || layout !== parent)) closeDiscussions();
  returnFocus =
    trigger ||
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  if (context && context.pageUid !== next.pageUid) closeInline();
  context = next;
  if (!host) {
    layout = parent;
    parent.classList.add("rmi-discussion-layout");
    host = document.createElement("div");
    host.id = HOST_ID;
    parent.appendChild(host);
    alignBadgesBesidePanel(parent, host);
    host.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && !e.isComposing) {
        e.stopPropagation();
        dismissRail();
      }
    });
  }
  renderRail();
  reconcileBadges();
};

type CommandApi = {
  addCommand: (args: {
    label: string;
    callback: (context?: { "block-uid"?: string }) => void;
  }) => unknown;
  removeCommand: (args: { label: string }) => unknown;
};

const command = (
  api: CommandApi | undefined,
  label: string,
  callback: (ctx?: { "block-uid"?: string }) => void,
): void => {
  if (!api?.addCommand || !api?.removeCommand) return;
  api.addCommand({ label, callback });
  disposeCommands.push(() => {
    api.removeCommand({ label });
  });
};

const openSafely = (uid?: string, trigger?: HTMLElement): void => {
  void openDiscussions(uid, trigger).catch((error) => {
    logError("could not open discussions", error);
    window.alert(
      error instanceof Error ? error.message : "Could not open discussions.",
    );
  });
};

const refreshPage = async (): Promise<void> => {
  const mine = ++refreshSequence;
  try {
    const pageOrBlock =
      await window.roamAlphaAPI.ui.mainWindow?.getOpenPageOrBlockUid();
    if (!pageOrBlock || mine !== refreshSequence) return;
    const page = await resolveDiscussionContext(pageOrBlock);
    if (mine !== refreshSequence) return;
    visiblePageUid = page.pageUid;
    if (inline) {
      const next = await fetchDiscussions(page.pageUid);
      if (mine !== refreshSequence) return;
      rememberSnapshot(next);
    } else {
      const next = await fetchBadgeCounts(page.pageUid);
      if (mine !== refreshSequence) return;
      counts = next;
      snapshot = { sources: [], threads: [] };
    }
    inlineError = "";
    renderInline();
    reconcileBadges();
  } catch (error) {
    if (mine !== refreshSequence) return;
    if (inline) {
      inlineError = "Could not refresh these discussions.";
      renderInline();
    }
    logError("could not refresh discussions", error);
  }
};

const refreshVisiblePage = (): void => {
  if (!document.hidden)
    void refreshPage().catch((e) =>
      logError("could not load discussion badges", e),
    );
};

const onNavigation = (): void => {
  refreshSequence += 1;
  sequence += 1;
  const reopenRail = Boolean(host);
  closeDiscussions();
  closeInline();
  rememberSnapshot({ sources: [], threads: [] });
  reconcileBadges();
  visiblePageUid = undefined;
  if (reopenRail) openSafely();
  refreshVisiblePage();
};

export const startDiscussions = (): void => {
  generation += 1;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DISCUSSION_CSS;
  document.getElementById(STYLE_ID)?.remove();
  document.head.appendChild(style);
  const ui = window.roamAlphaAPI.ui;
  command(ui.commandPalette as CommandApi, PAGE_COMMAND, () => openSafely());
  command(ui.commandPalette as CommandApi, BLOCK_COMMAND, () =>
    openSafely(ui.getFocusedBlock()?.["block-uid"]),
  );
  command(ui.blockContextMenu as CommandApi, CONTEXT_COMMAND, (ctx) =>
    openSafely(ctx?.["block-uid"]),
  );
  observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        ({ target }) =>
          target instanceof Element &&
          !target.closest(
            ".rmi-discussion-badge,.rmi-discussion-inline,#rmi-discussion-host",
          ) &&
          (target.closest(".roam-article") ||
            target.querySelector(".roam-article")),
      )
    )
      scheduleBadges();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", onNavigation);
  window.addEventListener(DISCUSSIONS_CHANGED, refreshVisiblePage);
  document.addEventListener("visibilitychange", refreshVisiblePage);
  refreshTimer = window.setInterval(refreshVisiblePage, 15000);
  refreshVisiblePage();
};

export const stopDiscussions = (): void => {
  generation += 1;
  refreshSequence += 1;
  window.clearInterval(refreshTimer);
  document.removeEventListener("visibilitychange", refreshVisiblePage);
  closeInline();
  rememberSnapshot({ sources: [], threads: [] });
  returnFocus = null;
  observer?.disconnect();
  observer = null;
  if (badgeTimer !== undefined) window.clearTimeout(badgeTimer);
  badgeTimer = undefined;
  visiblePageUid = undefined;
  for (const row of badges.keys()) removeBadge(row);
  closeDiscussions();
  for (const dispose of disposeCommands) {
    try {
      dispose();
    } catch {
      /* Roam may have already removed it */
    }
  }
  disposeCommands = [];
  window.removeEventListener("hashchange", onNavigation);
  window.removeEventListener(DISCUSSIONS_CHANGED, refreshVisiblePage);
  document.getElementById(STYLE_ID)?.remove();
  clearDiscussionDrafts();
};
