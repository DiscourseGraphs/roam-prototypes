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
  existingBlockUids,
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
let visibleKey = "";
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

const inputSelector = ".rm-block-text[id], .rm-block__input[id]";
const observedInputs = new Set<HTMLElement>();
const visibleInputs = new Set<HTMLElement>();
let viewport: IntersectionObserver | undefined;
let matchingUids = new Set<string>();
const candidatesFor = (input: HTMLElement): string[] => {
  const explicit =
    input.closest<HTMLElement>("[data-block-uid]")?.dataset.blockUid;
  if (explicit) return [explicit];
  if (!input.id.startsWith("block-input-"))
    return [input.id.replace(/^(?:block-|embed-)/, "")];
  // Window prefixes and imported UIDs can both contain hyphens.
  const parts = input.id.slice("block-input-".length).split("-");
  return parts.map((_, i) => parts.slice(i).join("-")).filter(Boolean);
};
const inputUid = (input: HTMLElement) => {
  const candidates = candidatesFor(input);
  return candidates.length === 1
    ? candidates[0]
    : candidates.find((uid) => matchingUids.has(uid));
};

const visitInputs = (root: Element, visit: (input: HTMLElement) => void) => {
  if (root.matches(inputSelector)) visit(root as HTMLElement);
  root.querySelectorAll<HTMLElement>(inputSelector).forEach(visit);
};
const observeInput = (input: HTMLElement) => {
  if (observedInputs.has(input) || !input.closest(".roam-article")) return;
  observedInputs.add(input);
  if (viewport) viewport.observe(input);
  else visibleInputs.add(input);
};
const forgetInput = (input: HTMLElement) => {
  if (input.isConnected || !observedInputs.delete(input)) return;
  viewport?.unobserve(input);
  visibleInputs.delete(input);
};

const dismissInline = (): void => {
  const trigger = inline?.trigger;
  closeInline();
  reconcileBadges();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
};

const refreshInline = async (): Promise<void> => {
  if (host) window.dispatchEvent(new Event(DISCUSSIONS_CHANGED));
  else await loadInline();
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
            onClick={() => void loadInline()}
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
    void loadInline();
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
      !input ||
      inputUid(input as HTMLElement) !== badge.uid
    )
      removeBadge(row);
  }
  if (!counts.size) return;
  visibleInputs.forEach((input) => {
    const uid = inputUid(input);
    if (!uid || !counts.has(uid)) return;
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
    if (viewportKey() !== visibleKey) refreshVisiblePage();
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

  ReactDOM.render(
    <DiscussionRail
      key={context.outlineUid || context.pageUid}
      context={context}
      onClose={dismissRail}
      onSnapshot={() => {
        refreshVisiblePage();
        if (inline) void loadInline();
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
  const currentUid =
    await window.roamAlphaAPI.ui.mainWindow?.getOpenPageOrBlockUid();
  const next = await resolveDiscussionContext(
    sourceUid || currentUid || undefined,
  );
  const view =
    currentUid && sourceUid && currentUid !== sourceUid
      ? await resolveDiscussionContext(currentUid)
      : currentUid
        ? next
        : undefined;
  if (
    view?.sourceUid &&
    !view.nativeStorage &&
    view.pageUid === next.pageUid &&
    (!sourceUid ||
      sourceUid === view.sourceUid ||
      next.ancestors?.includes(view.sourceUid))
  ) {
    next.outlineUid = view.sourceUid;
    next.title = view.outlineTitle || view.title;
    if (!sourceUid) next.sourceUid = undefined;
  }
  if (mine !== sequence || owner !== generation) return;
  const parent = document.querySelector<HTMLElement>(".roam-body-main");
  if (!parent) throw new Error("Roam’s main page is not available yet.");
  if (host && (!host.isConnected || layout !== parent)) closeDiscussions();
  returnFocus =
    trigger ||
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  if (
    context &&
    context.pageUid !== next.pageUid &&
    inline?.trigger !== trigger
  )
    closeInline();
  const expandedThread =
    inline && inline.trigger === trigger && inline.uid === sourceUid
      ? inline.mount.querySelector<HTMLElement>(
          '[data-expanded="true"][data-thread-uid]',
        )
      : null;
  context = { ...next, threadUid: expandedThread?.dataset.threadUid };
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

const viewportKey = () =>
  JSON.stringify(Array.from(visibleInputs, (input) => candidatesFor(input)));

const loadInline = async () => {
  const selected = inline;
  if (!selected) return;
  try {
    const result = await fetchDiscussions(selected.uid, "inline");
    if (inline !== selected) return;
    snapshot = result;
    inlineError = "";
  } catch (error) {
    if (inline !== selected) return;
    inlineError = "Could not refresh these discussions.";
    logError("could not refresh inline discussions", error);
  }
  renderInline();
};

const refreshPage = async () => {
  const mine = ++refreshSequence;
  visibleKey = viewportKey();
  const inputs = Array.from(visibleInputs, candidatesFor);
  const ambiguous = [
    ...new Set(inputs.filter((list) => list.length > 1).flat()),
  ];
  const existing = new Set<string>();
  for (let i = 0; i < ambiguous.length; i += 100) {
    const found = await existingBlockUids(ambiguous.slice(i, i + 100));
    if (mine !== refreshSequence) return;
    found.forEach((uid) => existing.add(uid));
  }
  const targets = new Set<string>();
  for (const list of inputs) {
    const uid =
      list.length === 1
        ? list[0]
        : list.find((candidate) => existing.has(candidate));
    if (uid) targets.add(uid);
  }
  if (inline) {
    // Scrolling through a long conversation can take its source button outside
    // the observed viewport while both the button and the discussion stay mounted.
    existing.add(inline.uid);
    targets.add(inline.uid);
  }
  const uids = [...targets];
  const nextCounts = new Map<string, number>();
  for (let i = 0; i < uids.length; i += 100) {
    const batch = await fetchBadgeCounts(uids.slice(i, i + 100));
    if (mine !== refreshSequence) return;
    for (const [uid, count] of batch) nextCounts.set(uid, count);
  }
  matchingUids = existing;
  counts = nextCounts;
  reconcileBadges();
};
const refreshVisiblePage = (): void => {
  if (document.hidden) return;
  void refreshPage().catch((e) =>
    logError("could not load discussion badges", e),
  );
};
const refreshChanged = () => {
  refreshVisiblePage();
  if (!host && !document.hidden) void loadInline();
};

const onNavigation = (): void => {
  refreshSequence += 1;
  sequence += 1;
  const reopenRail = Boolean(host);
  closeDiscussions();
  closeInline();
  counts.clear();
  snapshot = { sources: [], threads: [] };
  reconcileBadges();
  visibleKey = "";
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
  if (typeof IntersectionObserver !== "undefined") {
    viewport = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const input = entry.target as HTMLElement;
          if (!observedInputs.has(input)) continue;
          if (entry.isIntersecting) visibleInputs.add(input);
          else visibleInputs.delete(input);
        }
        scheduleBadges();
      },
      { rootMargin: "200px" },
    );
  }
  document
    .querySelectorAll(".roam-article")
    .forEach((root) => visitInputs(root, observeInput));
  observer = new MutationObserver((mutations) => {
    let relevant = false;
    for (const mutation of mutations) {
      if (
        (mutation.target as Element).closest?.(
          ".rmi-discussion-badge,.rmi-discussion-inline,#rmi-discussion-host",
        )
      )
        continue;
      relevant = true;
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) visitInputs(node, observeInput);
      }
      for (const node of Array.from(mutation.removedNodes)) {
        if (node instanceof Element) visitInputs(node, forgetInput);
      }
    }
    if (relevant) scheduleBadges();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["id", "data-block-uid"],
  });
  window.addEventListener("hashchange", onNavigation);
  window.addEventListener(DISCUSSIONS_CHANGED, refreshChanged);
  document.addEventListener("visibilitychange", refreshVisiblePage);
  refreshTimer = window.setInterval(refreshChanged, 60000);
  refreshVisiblePage();
};

export const stopDiscussions = (): void => {
  generation += 1;
  refreshSequence += 1;
  window.clearInterval(refreshTimer);
  document.removeEventListener("visibilitychange", refreshVisiblePage);
  closeInline();
  counts.clear();
  snapshot = { sources: [], threads: [] };
  returnFocus = null;
  viewport?.disconnect();
  viewport = undefined;
  visibleInputs.clear();
  observedInputs.clear();
  observer?.disconnect();
  observer = null;
  if (badgeTimer !== undefined) window.clearTimeout(badgeTimer);
  badgeTimer = undefined;
  visibleKey = "";
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
  window.removeEventListener(DISCUSSIONS_CHANGED, refreshChanged);
  document.getElementById(STYLE_ID)?.remove();
  clearDiscussionDrafts();
};
