import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscussionDrafts,
  DiscussionRail,
  InlineDiscussions,
} from "~/discussion-rail";
import {
  fetchDiscussions,
  findDiscussionSources,
  postNativeComment,
  setThreadResolved,
  type DiscussionSnapshot,
} from "~/discussion-data";
import { installFakeRoam } from "./fixtures";

vi.mock("~/discussion-data", async (original) => ({
  ...(await original<typeof import("~/discussion-data")>()),
  fetchDiscussions: vi.fn(),
  findDiscussionSources: vi.fn(),
  postNativeComment: vi.fn(),
  setThreadResolved: vi.fn(),
  canAddComments: () => true,
}));

const source = { uid: "source", string: "Discuss this block", order: 0 };
const snapshot: DiscussionSnapshot = {
  sources: [source],
  threads: [
    {
      uid: "root",
      string: "An open question",
      children: [],
      author: "Alex Chen",
      time: 100,
      source,
      resolved: false,
      replies: [],
    },
  ],
};
let host: HTMLDivElement;
const buttons = (text: string): HTMLButtonElement => {
  const button = Array.from(host.querySelectorAll("button")).find(
    (b) =>
      b.getAttribute("aria-label") === text || b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
};
const click = async (text: string): Promise<void> => {
  await act(async () => {
    buttons(text).click();
  });
};
const type = (text: string): void => {
  act(() => {
    const textarea = host.querySelector("textarea");
    if (!textarea) throw new Error("Missing composer");
    textarea.value = text;
    Simulate.change(textarea);
  });
};
const mount = async (sourceUid = "source", composeComment = false, nativeStorage = false): Promise<void> => {
  await act(async () => {
    ReactDOM.render(
      <DiscussionRail
        context={{ pageUid: "page", title: "Notes", sourceUid, composeComment, nativeStorage }}
        onClose={() => {}}
        onSnapshot={() => {}}
      />,
      host,
    );
  });
};

beforeEach(() => {
  sessionStorage.clear();
  installFakeRoam();
  clearDiscussionDrafts();
  host = document.createElement("div");
  document.body.appendChild(host);
  vi.mocked(fetchDiscussions).mockResolvedValue(structuredClone(snapshot));
  vi.mocked(findDiscussionSources).mockResolvedValue([source]);
  vi.mocked(postNativeComment).mockResolvedValue(undefined);
  vi.mocked(setThreadResolved).mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(host);
  });
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("discussion rail", () => {
  it("renders 25 summaries at a time while keeping older selected threads reachable", async () => {
    const threads = Array.from({ length: 31 }, (_, i) => ({
      ...snapshot.threads[0],
      uid: "topic-" + i,
    }));
    vi.mocked(fetchDiscussions).mockResolvedValue({
      sources: [source],
      threads,
    });
    await mount("topic-30");
    expect(host.querySelectorAll("[data-thread-uid]")).toHaveLength(26);
    expect(
      host
        .querySelector('[data-thread-uid="topic-30"]')
        ?.getAttribute("data-expanded"),
    ).toBe("true");
    await click("Load more discussions");
    expect(host.querySelectorAll("[data-thread-uid]")).toHaveLength(31);
  });

  it("posts replies to the topic UID and new threads to the source UID", async () => {
    await mount();
    type("Reply text");
    await click("Reply");
    expect(postNativeComment).toHaveBeenLastCalledWith({
      uid: "root",
      text: "Reply text",
      kind: "reply",
    });
    expect(host.querySelector("textarea")?.value).toBe("");
    await click("New thread");
    type("A separate topic");
    await click("Post thread");
    expect(postNativeComment).toHaveBeenLastCalledWith({
      uid: "source",
      text: "A separate topic",
      kind: "thread",
    });
  });

  it("opens the composer for the clicked block when the rail is already open", async () => {
    await mount();
    await mount("clicked-block", true);
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="New thread"]');
    expect(document.activeElement).toBe(textarea);
    expect(host.querySelector("select")).toBeNull();
    type("Comment from the bullet menu");
    await click("Post thread");
    expect(postNativeComment).toHaveBeenCalledWith({
      uid: "clicked-block",
      kind: "thread",
      text: "Comment from the bullet menu",
    });
    expect(host.querySelector('textarea[aria-label="New thread"]')).toBeNull();
  });

  it("opens a resolved native comment without creating a thread beneath it", async () => {
    vi.mocked(fetchDiscussions).mockResolvedValue({
      ...snapshot,
      threads: [{ ...snapshot.threads[0], resolved: true }],
    });
    await mount("root", true, true);
    expect(host.querySelector('textarea[aria-label="New thread"]')).toBeNull();
    expect(host.querySelector('[data-thread-uid="root"]')?.getAttribute("data-expanded")).toBe("true");
  });

  it("posts to the visible picker option when the requested block is ineligible", async () => {
    await mount("empty-block");
    await click("New thread");
    expect(host.querySelector("select")?.value).toBe(source.uid);
    type("A new topic");
    await click("Post thread");
    expect(postNativeComment).toHaveBeenCalledWith({
      uid: source.uid,
      kind: "thread",
      text: "A new topic",
    });
  });

  it("keeps focus inside the compact panel while loading and after failure, then focuses the recovered thread", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    let fail!: (reason: Error) => void;
    vi.mocked(fetchDiscussions).mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    await mount();
    expect(document.activeElement).toBe(buttons("Close discussions"));
    await act(async () => fail(new Error("Offline")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Offline",
    );
    expect(document.activeElement).toBe(buttons("Close discussions"));
    await click("Retry");
    expect(document.activeElement?.getAttribute("data-thread-uid")).toBe(
      "root",
    );
  });

  it("can cancel composition when the final source disappears", async () => {
    await mount();
    await click("New thread");
    vi.mocked(findDiscussionSources).mockResolvedValue([]);
    vi.mocked(fetchDiscussions).mockResolvedValue({ sources: [], threads: [] });
    await click("Refresh discussions");
    expect(host.textContent).toContain("No matching source blocks");
    expect(buttons("Cancel").disabled).toBe(false);
    await click("Cancel");
    expect(buttons("New thread").disabled).toBe(false);
  });

  it("retains a rejected reply, and keeps its draft when switching filters", async () => {
    vi.mocked(postNativeComment).mockRejectedValueOnce(
      new Error("Permission denied"),
    );
    await mount();
    type("Keep my draft");
    await click("Reply");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Permission denied",
    );
    expect(host.querySelector("textarea")?.value).toBe("Keep my draft");
    await click("Resolved");
    expect(host.querySelector("textarea")).toBeNull();
    await click("Open");
    expect(host.querySelector("textarea")?.value).toBe("Keep my draft");
  });

  it("keeps focus inside the compact rail when resolving or reopening hides the thread", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await mount();
    vi.mocked(fetchDiscussions).mockResolvedValue({
      sources: [source],
      threads: [{ ...snapshot.threads[0], resolved: true }],
    });
    buttons("Resolve").focus();
    await click("Resolve");
    expect(document.activeElement).toBe(buttons("Close discussions"));
    expect(setThreadResolved).toHaveBeenCalledWith({
      uid: "root",
      resolved: true,
    });
    expect(host.textContent).toContain("No open discussions");
    await click("Resolved");
    vi.mocked(fetchDiscussions).mockResolvedValue(snapshot);
    buttons("Reopen").focus();
    await click("Reopen");
    expect(document.activeElement).toBe(buttons("Close discussions"));
    expect(setThreadResolved).toHaveBeenLastCalledWith({
      uid: "root",
      resolved: false,
    });
  });

  it("keeps quiet thread controls accessible in the rail and inline", async () => {
    const verifyControls = async () => {
      const collapse = buttons("Collapse thread");
      expect(collapse.getAttribute("data-tooltip")).toBe("Collapse thread");
      expect(collapse.querySelector(".bp3-button-text")).toBeNull();
      expect(collapse.getAttribute("aria-expanded")).toBe("true");
      const resolve = buttons("Resolve");
      expect(resolve.getAttribute("data-tooltip")).toBe("Resolve thread");
      expect(resolve.querySelector(".bp3-button-text")).toBeNull();
      resolve.focus();
      expect(document.activeElement).toBe(resolve);
      await click("Collapse thread");
      expect(buttons("Expand thread").getAttribute("aria-expanded")).toBe(
        "false",
      );
      await click("Expand thread");
      expect(host.querySelector("textarea")).not.toBeNull();
    };
    await mount();
    await verifyControls();
    act(() => {
      ReactDOM.unmountComponentAtNode(host);
    });
    await act(async () => {
      ReactDOM.render(
        <InlineDiscussions
          threads={snapshot.threads}
          reload={async () => {}}
          onOpenPage={() => {}}
          onClose={() => {}}
        />,
        host,
      );
    });
    await verifyControls();
  });
  it.each(["addressed-topic", "addressed-reply"])(
    "opens the owning thread for %s",
    async (uid) => {
      const addressed = {
        ...snapshot.threads[0],
        uid: "addressed-topic",
        resolved: true,
        replies: [{ ...snapshot.threads[0], uid: "addressed-reply" }],
      };
      vi.mocked(fetchDiscussions).mockResolvedValue({
        sources: [source],
        threads: [snapshot.threads[0], addressed],
      });
      await mount(uid);
      expect(document.activeElement?.getAttribute("data-thread-uid")).toBe(
        addressed.uid,
      );
      expect(buttons("Resolved").getAttribute("aria-pressed")).toBe("true");
    },
  );

  it("groups threads under one source link and puts the selected source first", async () => {
    vi.mocked(fetchDiscussions).mockResolvedValue({
      sources: [source],
      threads: [
        {
          ...snapshot.threads[0],
          uid: "other-thread",
          source: { uid: "other", string: "Another block", order: 1 },
        },
        snapshot.threads[0],
        { ...snapshot.threads[0], uid: "second", string: "Second question" },
      ],
    });
    await mount();
    const groups = host.querySelectorAll(".rmi-discussion-group");
    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute("aria-label")).toBe(source.string);
    expect(groups[0].querySelectorAll(".rmi-discussion-source")).toHaveLength(
      1,
    );
    expect(groups[0].querySelectorAll("article")).toHaveLength(2);
  });
  it("shares a pending post across remounts and clears the recovered draft once", async () => {
    let finish!: () => void;
    vi.mocked(postNativeComment).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    type("Only once");
    await click("Reply");
    await click("Resolved");
    await click("Open");
    expect(host.querySelector("textarea")?.disabled).toBe(true);
    expect(vi.mocked(postNativeComment)).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(sessionStorage.length).toBe(0);
  });

  it("recovers an unsent draft in the same tab after unloading", async () => {
    await mount();
    type("Keep across reload");
    act(() => {
      ReactDOM.unmountComponentAtNode(host);
    });
    clearDiscussionDrafts();
    await mount();
    expect(host.querySelector("textarea")?.value).toBe("Keep across reload");
  });

  it("shows a read failure with retry, then recovers", async () => {
    vi.mocked(fetchDiscussions).mockRejectedValueOnce(new Error("Offline"));
    await mount();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Offline",
    );
    await click("Retry");
    expect(host.textContent).toContain("An open question");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("ignores an in-flight load after unmount and does not register a recursive page watch", async () => {
    let finish: (value: DiscussionSnapshot) => void = () => {};
    vi.mocked(fetchDiscussions).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const changed = vi.fn();
    const watch = vi.spyOn(window.roamAlphaAPI.data, "addPullWatch");
    await act(async () => {
      ReactDOM.render(
        <DiscussionRail
          context={{ pageUid: "page", title: "Notes" }}
          onClose={() => {}}
          onSnapshot={changed}
        />,
        host,
      );
    });
    act(() => {
      ReactDOM.unmountComponentAtNode(host);
    });
    await act(async () => {
      finish(snapshot);
    });
    expect(changed).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
  });
});
