import { act } from "react-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  fetchBadgeCounts,
  fetchDiscussions,
  resolveDiscussionContext,
} from "~/discussion-data";
import {
  openDiscussions,
  startDiscussions,
  stopDiscussions,
} from "~/discussions";
import { installFakeRoam } from "./fixtures";

vi.mock("~/discussion-data", async (original) => ({
  ...(await original<typeof import("~/discussion-data")>()),
  fetchDiscussions: vi.fn(),
  fetchBadgeCounts: vi.fn(),
  resolveDiscussionContext: vi.fn(),
}));

afterEach(() => {
  act(stopDiscussions);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps a resolved-only badge across inline, focused rail, and closed views", async () => {
  const api = installFakeRoam();
  Object.assign(api.ui, {
    mainWindow: { getOpenPageOrBlockUid: () => "page" },
  });
  vi.stubGlobal("CSS", { escape: (uid: string) => uid });
  document.body.innerHTML =
    '<div class="roam-body-main"><div class="rm-article-wrapper" style="padding-right: 12px"><div class="roam-article"><div class="rm-block-main"><div class="rm-block-text" id="block-source">Original block</div><button aria-label="References">2</button></div></div></div></div>';
  const layout = document.querySelector<HTMLElement>(".roam-body-main")!;
  Object.defineProperty(
    layout.querySelector(".rm-article-wrapper"),
    "clientWidth",
    {
      value: 800,
    },
  );
  const source = { uid: "source", string: "Original block", order: 0 };
  vi.mocked(resolveDiscussionContext).mockImplementation(async (uid) => ({
    pageUid: "page",
    title: "Sample",
    sourceUid: uid === source.uid ? uid : undefined,
  }));
  vi.mocked(fetchBadgeCounts).mockResolvedValue(new Map([["source", 1]]));
  const response = {
    sources: [source],
    threads: [
      {
        uid: "native-comment",
        source,
        string: "Resolved comment",
        resolved: true,
        author: "A",
        time: 0,
        children: [],
        replies: [],
      },
    ],
  };
  vi.mocked(fetchDiscussions).mockResolvedValue(response);
  await act(async () => {
    startDiscussions();
  });
  const badge = document.querySelector<HTMLButtonElement>(
    ".rmi-discussion-badge button",
  )!;
  expect(fetchDiscussions).not.toHaveBeenCalled();
  expect(badge.textContent).toBe("1");
  expect(document.querySelector(".rm-block-main")?.lastElementChild).toBe(
    badge.parentElement,
  );
  await act(async () => {
    badge.click();
  });
  expect(
    document.querySelector(
      ".rm-block-main + .rmi-discussion-inline [data-thread-uid='native-comment']",
    )?.textContent,
  ).toContain("Resolved comment");
  // An open sibling would normally win the rail's initial Open filter.
  vi.mocked(fetchDiscussions).mockResolvedValue({
    ...response,
    threads: [
      { ...response.threads[0], uid: "other-thread", resolved: false },
      ...response.threads,
    ],
  });
  await act(async () => {
    badge.dispatchEvent(
      new MouseEvent("click", { bubbles: true, shiftKey: true }),
    );
  });
  expect(document.querySelector(".rmi-discussion-inline")).not.toBeNull();
  expect(
    document.activeElement
      ?.closest("[data-thread-uid]")
      ?.getAttribute("data-thread-uid"),
  ).toBe("native-comment");
  expect(
    document
      .querySelector(".rmi-discussion-filters [aria-pressed=true]")
      ?.getAttribute("aria-label"),
  ).toBe("Resolved");
  expect(badge.getAttribute("aria-current")).toBe("true");
  expect(layout.style.getPropertyValue("--rmi-badge-inset")).toBe("796px");
  const rail = document.querySelector(".rmi-discussion-rail");
  const reads = vi.mocked(fetchDiscussions).mock.calls.length;
  await act(async () => {
    badge.click();
    document.body.click();
  });
  expect(document.querySelector(".rmi-discussion-rail")).toBe(rail);
  expect(fetchDiscussions).toHaveBeenCalledTimes(reads);
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close discussions"]')
      ?.click();
  });
  expect(document.querySelector("#rmi-discussion-host")).toBeNull();
  expect(badge.getAttribute("aria-expanded")).toBe("true");
  expect(badge.hasAttribute("aria-current")).toBe(false);
  expect(layout.style.getPropertyValue("--rmi-badge-inset")).toBe("");
  await act(async () => {
    badge.click();
  });
  expect(document.querySelector(".rmi-discussion-inline")).toBeNull();
  expect(badge.isConnected).toBe(true);
  act(stopDiscussions);
  expect(badge.isConnected).toBe(false);
});

it("keeps both rendered copies interactive while the panel visits another page", async () => {
  const api = installFakeRoam();
  Object.assign(api.ui, {
    mainWindow: { getOpenPageOrBlockUid: () => "page-a" },
  });
  vi.stubGlobal("CSS", { escape: (uid: string) => uid });
  document.body.innerHTML = `<div class="roam-body-main"><div class="roam-article">
    <div class="rm-block-main"><div class="rm-block-text" id="block-source">Source</div></div>
    <div class="rm-block-main"><div class="rm-block-text" id="embed-source">Source</div></div>
  </div></div>`;
  vi.mocked(resolveDiscussionContext).mockImplementation(async (uid) => ({
    pageUid: uid === "remote" ? "page-b" : "page-a",
    title: "Notes",
    sourceUid: uid === "page-a" ? undefined : uid,
  }));
  const source = { uid: "source", string: "Source", order: 0 };
  const topic = {
    uid: "topic",
    source,
    string: "On page A",
    resolved: false,
    author: "A",
    time: 0,
    children: [],
    replies: [],
  };
  vi.mocked(fetchBadgeCounts).mockResolvedValue(new Map([["source", 1]]));
  vi.mocked(fetchDiscussions).mockImplementation(async (pageUid) =>
    pageUid === "page-a" || pageUid === "source"
      ? { sources: [source], threads: [topic] }
      : { sources: [], threads: [] },
  );
  await act(async () => {
    startDiscussions();
  });
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".rmi-discussion-badge button",
    ),
  );
  expect(buttons).toHaveLength(2);
  const [original, embed] = buttons;
  await act(async () => {
    original.click();
  });
  await act(async () => {
    embed.click();
  });
  expect(
    embed.closest(".rm-block-main")?.nextElementSibling?.textContent,
  ).toContain("On page A");
  expect(original.getAttribute("aria-expanded")).toBe("false");
  expect(embed.getAttribute("aria-expanded")).toBe("true");
  await act(async () => {
    await openDiscussions("remote");
  });
  expect(fetchDiscussions).toHaveBeenCalledWith("page-b", "page");
  await act(async () => {
    window.dispatchEvent(new Event("rmi-native-discussions-changed"));
  });
  expect(
    embed.closest(".rm-block-main")?.nextElementSibling?.textContent,
  ).toContain("On page A");
  expect(original.isConnected && embed.isConnected).toBe(true);
  await act(async () => {
    embed.click();
  });
  expect(document.querySelector(".rmi-discussion-rail")?.textContent).toContain(
    "On page A",
  );
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close discussions"]')
      ?.click();
  });
  expect(document.activeElement).toBe(embed);
  act(stopDiscussions);
  expect(document.querySelector(".rmi-discussion-badge")).toBeNull();
});

it("queries only near-viewport source UIDs, including embeds, in batches of at most 100", async () => {
  const api = installFakeRoam();
  Object.assign(api.ui, {
    mainWindow: { getOpenPageOrBlockUid: () => "archive" },
  });
  const rows = Array.from(
    { length: 200 },
    (_, i) =>
      `<div data-block-uid="source-${i}"><div class="rm-block-text" id="block-input-embed-window-source-${i}"></div></div>`,
  ).join("");
  document.body.innerHTML = `<main class="roam-article">${rows}</main>`;
  let enter: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof enter) {
        enter = callback;
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    },
  );
  vi.mocked(fetchBadgeCounts).mockResolvedValue(new Map());
  vi.useFakeTimers();
  try {
    await act(async () => {
      startDiscussions();
    });
    expect(fetchBadgeCounts).not.toHaveBeenCalled();
    const visible = Array.from(
      document.querySelectorAll(".rm-block-text"),
    ).slice(0, 105);
    await act(async () => {
      enter(visible.map((target) => ({ target, isIntersecting: true })));
      await vi.advanceTimersByTimeAsync(105);
    });
    const batches = vi
      .mocked(fetchBadgeCounts)
      .mock.calls.map(([uids]) => uids);
    expect(batches.map((batch) => batch.length)).toEqual([100, 5]);
    expect(new Set(batches.flat())).toEqual(
      new Set(visible.map((node) => node.parentElement!.dataset.blockUid)),
    );
    expect(fetchDiscussions).not.toHaveBeenCalled();
    act(stopDiscussions);
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
