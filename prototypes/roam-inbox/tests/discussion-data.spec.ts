import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeRoam } from "./fixtures";
import {
  fetchBadgeCounts,
  fetchDiscussions,
  isResolved,
  postNativeComment,
  Q_PAGE_COMMENTS,
  Q_PAGE_SOURCES,
  Q_REPLY_COMMENTS,
  resolveDiscussionContext,
  setThreadResolved,
  shapeComments,
} from "~/discussion-data";

const source = {
  ":block/uid": "source",
  ":block/string": "A source block",
  ":block/order": 0,
};
const root = {
  ":block/uid": "root",
  ":block/string": "A topic",
  ":create/time": 10,
};
const container = (string: string, children: unknown[]): unknown => ({
  ":block/string": string,
  ":block/_children": [{ ":block/string": "[[Alex Chen]]" }],
  ":block/children": children,
});

afterEach(() => vi.restoreAllMocks());

describe("native discussion reads", () => {
  it("splits same-day sibling comments into independent topics, preserving order and authors", () => {
    const result = shapeComments(
      container("((source))", [
        { ...root, ":block/order": 1 },
        {
          uid: "earlier",
          string: "First topic",
          order: 0,
          children: [{ uid: "nested", string: "A list item" }],
        },
      ]),
    );
    expect(result.map((r) => r.uid)).toEqual(["earlier", "root"]);
    expect(result[0].author).toBe("Alex Chen");
    expect(result[0].children[0].string).toBe("A list item");
  });

  it("queries visible embedded UIDs separately from their host page", async () => {
    const api = installFakeRoam();
    const query = vi
      .spyOn(api.data.async, "q")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["embedded", "((embedded))", 2]]);
    expect(await fetchBadgeCounts("host-page", ["embedded"])).toEqual(
      new Map([["embedded", 2]]),
    );
    expect(query.mock.calls[1][1]).toEqual(["embedded"]);
    expect(query.mock.calls[1][0]).not.toContain(":block/page");
  });

  it("reads closed-page counts without loading reply content or counting prose references", async () => {
    const api = installFakeRoam();
    const query = vi.spyOn(api.data.async, "q").mockResolvedValue([
      ["source", "((source))", 3],
      ["source", "Mention ((source))", 2],
    ]);
    expect(await fetchBadgeCounts("page")).toEqual(new Map([["source", 3]]));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toContain("(pull");
    for (const nativeQuery of [
      query.mock.calls[0][0],
      Q_PAGE_COMMENTS,
      Q_REPLY_COMMENTS,
    ]) {
      expect(nativeQuery).toContain("[?comments :block/children ?date]");
      expect(nativeQuery).toContain("[?date :block/children ?author]");
      expect(nativeQuery).toContain("[?author :block/children ?container]");
    }
  });

  it("loads a page and batches native replies, excluding prose references", async () => {
    const api = installFakeRoam();
    const query = vi
      .spyOn(api.data.async, "q")
      .mockImplementation(async (q, ...args) => {
        if (q === Q_PAGE_SOURCES) return [[source]];
        if (q === Q_PAGE_COMMENTS)
          return [
            [
              source,
              container("((source))", [
                root,
                {
                  uid: "root2",
                  string: "Another topic",
                  ":block/props": { ":roam-inbox": { ":resolved": true } },
                },
              ]),
            ],
            [
              source,
              container("An ordinary reference to ((source))", [
                { uid: "not-a-comment", string: "Prose" },
              ]),
            ],
          ];
        if (q === Q_REPLY_COMMENTS) {
          expect(args).toEqual([["root", "root2"]]);
          return [
            [
              "root",
              container("((root))", [
                { uid: "reply-later", string: "Later", ":create/time": 22 },
                { uid: "reply-first", string: "Earlier", ":create/time": 11 },
              ]),
            ],
          ];
        }
        throw new Error("Unexpected query");
      });
    const result = await fetchDiscussions("page");
    expect(result.threads.map((t) => t.uid)).toEqual(["root", "root2"]);
    expect(result.threads[0].replies.map((r) => r.uid)).toEqual([
      "reply-first",
      "reply-later",
    ]);
    expect(result.threads[1].resolved).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(Q_PAGE_COMMENTS, "page");
  });

  it("surfaces graph-read failures rather than presenting an empty discussion", async () => {
    const api = installFakeRoam();
    vi.spyOn(api.data.async, "q").mockRejectedValue(new Error("Offline"));
    await expect(fetchDiscussions("page")).rejects.toThrow("Offline");
  });

  it("resolves a block to its containing page, and refuses deleted targets", async () => {
    const api = installFakeRoam();
    vi.spyOn(api.data.async, "pull").mockResolvedValueOnce({
      uid: "source",
      string: "Source",
      page: { uid: "page", title: "Notes" },
    } as never);
    await expect(resolveDiscussionContext("source")).resolves.toEqual({
      pageUid: "page",
      title: "Notes",
      sourceUid: "source",
    });
    await expect(resolveDiscussionContext("deleted")).rejects.toThrow(
      "no longer exists",
    );
  });
});

describe("native discussion writes", () => {
  it("posts to the exact source or topic UID through addComment, never createBlock", async () => {
    const api = installFakeRoam();
    vi.spyOn(api.data.async, "pull").mockResolvedValue({
      uid: "target",
    } as never);
    const addComment = vi.fn().mockResolvedValue(undefined);
    Object.assign(api.data.block, { addComment });
    const create = vi.spyOn(api.data.block, "create");
    await postNativeComment({
      kind: "reply",
      uid: "target",
      text: "  A [[Roam]] reply  ",
    });
    expect(addComment).toHaveBeenCalledWith({
      "block-uid": "target",
      "reply-string": "A [[Roam]] reply",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("checks the current resolution before writing a reply and permits it after reopening", async () => {
    const api = installFakeRoam();
    const addComment = vi.fn();
    Object.assign(api.data.block, { addComment });
    const pull = vi.spyOn(api.data.async, "pull").mockResolvedValue({
      ":block/uid": "topic",
      ":block/props": { ":roam-inbox": { ":resolved": true } },
    } as never);
    const reply = { kind: "reply" as const, uid: "topic", text: "My draft" };
    await expect(postNativeComment(reply)).rejects.toThrow("Reopen");
    expect(pull).toHaveBeenCalledWith(expect.stringContaining(":block/props"), [
      ":block/uid",
      "topic",
    ]);
    expect(addComment).not.toHaveBeenCalled();
    pull.mockResolvedValue({ uid: "topic", props: {} } as never);
    await postNativeComment(reply);
    expect(addComment).toHaveBeenCalledTimes(1);
  });

  it("rejects empty comments, unavailable capabilities, deleted targets and failed writes", async () => {
    const api = installFakeRoam();
    await expect(
      postNativeComment({ kind: "reply", uid: "target", text: " " }),
    ).rejects.toThrow("Write a comment");
    await expect(
      postNativeComment({ kind: "reply", uid: "target", text: "hello" }),
    ).rejects.toThrow("does not support");
    const addComment = vi.fn().mockRejectedValue(new Error("Read only"));
    Object.assign(api.data.block, { addComment });
    await expect(
      postNativeComment({ kind: "reply", uid: "target", text: "hello" }),
    ).rejects.toThrow("deleted");
    expect(addComment).not.toHaveBeenCalled();
    vi.spyOn(api.data.async, "pull").mockResolvedValue({
      uid: "target",
    } as never);
    await expect(
      postNativeComment({ kind: "reply", uid: "target", text: "hello" }),
    ).rejects.toThrow("Read only");
  });

  it("resolves and reopens without rewriting text or dropping unrelated props", async () => {
    const api = installFakeRoam();
    vi.spyOn(api.data.async, "pull").mockResolvedValue({
      ":block/uid": "root",
      ":block/props": {
        ":other-plugin": { ":pinned": true },
        ":roam-inbox": { ":existing": "keep", ":resolved": true },
      },
    } as never);
    const update = vi.spyOn(api.data.block, "update");
    await setThreadResolved({ uid: "root", resolved: false });
    expect(update).toHaveBeenCalledWith({
      block: {
        uid: "root",
        props: {
          "other-plugin": { pinned: true },
          "roam-inbox": { existing: "keep", resolved: false, resolvedAt: null },
        },
      },
    });
    expect(isResolved({ props: { "roam-inbox": { resolved: false } } })).toBe(
      false,
    );
    expect(isResolved({ props: { "roam-inbox": { resolved: "true" } } })).toBe(
      false,
    );
  });
});
