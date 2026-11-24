import { graphName, pick } from "~/roam";

export const DISCUSSIONS_CHANGED = "rmi-native-discussions-changed";

export type DiscussionSource = { uid: string; string: string; order: number };
export type CommentContent = {
  uid: string;
  string: string;
  children: CommentContent[];
};
export type DiscussionComment = CommentContent & {
  author: string;
  time: number;
};
export type DiscussionThread = DiscussionComment & {
  source: DiscussionSource;
  resolved: boolean;
  replies: DiscussionComment[];
};
export type DiscussionContext = {
  pageUid: string;
  title: string;
  sourceUid?: string;
  threadUid?: string;
};
export type DiscussionSnapshot = {
  sources: DiscussionSource[];
  threads: DiscussionThread[];
};

const CONTENT = `[:block/uid :block/string :block/order {:block/children ...}]`;
const COMMENT = `[:block/uid :block/string :block/order :block/props :create/time
  {:create/user [{:user/display-page [:node/title]}]}
  {:block/children ${CONTENT}}]`;
const CONTAINER = `[:block/uid :block/string
  {:block/_children [:block/string]}
  {:block/children ${COMMENT}}]`;

// Native storage: page → [[roam/comments]] → date → author → ((source)) → replies.
const COMMENT_REFERENCE = `[?container :block/refs ?source]
  [?author :block/children ?container] [?date :block/children ?author]
  [?comments :block/children ?date] [?comments :block/string "[[roam/comments]]"]`;
const NATIVE_CONTAINERS = `[?page :block/uid ?pageUid] [?source :block/page ?page]
  ${COMMENT_REFERENCE}
  (not-join [?source] [?source :block/parents ?root] [?root :block/string "[[roam/comments]]"])`;

export const Q_PAGE_COMMENTS = `[:find (pull ?source [:block/uid :block/string :block/order])
  (pull ?container ${CONTAINER}) :in $ ?pageUid :where ${NATIVE_CONTAINERS}]`;

const Q_BADGE_COUNTS = `[:find ?uid ?reference (count-distinct ?thread) :in $ ?pageUid :where
  ${NATIVE_CONTAINERS} [?source :block/uid ?uid] [?container :block/string ?reference]
  [?container :block/children ?thread]]`;

// The closed page needs counts only. Fetch comment bodies and replies when a view opens.
export const fetchBadgeCounts = async (
  pageUid: string,
): Promise<Map<string, number>> => {
  const rows = await window.roamAlphaAPI.data.async.q(Q_BADGE_COUNTS, pageUid);
  const counts = new Map<string, number>();
  for (const [uid, reference, count] of rows) {
    if (
      typeof uid === "string" &&
      reference === `((${uid}))` &&
      typeof count === "number"
    )
      counts.set(uid, count);
  }
  return counts;
};

export const Q_REPLY_COMMENTS = `[:find ?uid (pull ?container ${CONTAINER})
  :in $ [?uid ...] :where [?source :block/uid ?uid]
  ${COMMENT_REFERENCE}]`;

export const Q_PAGE_SOURCES = `[:find (pull ?source [:block/uid :block/string :block/order])
  :in $ ?pageUid :where [?page :block/uid ?pageUid] [?source :block/page ?page]
  [?source :block/string ?text]
  (not-join [?source] [?source :block/string "[[roam/comments]]"])
  (not-join [?source] [?source :block/parents ?root] [?root :block/string "[[roam/comments]]"])]`;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const prop = (value: unknown, key: string): unknown => {
  const obj = record(value);
  return obj[`:${key}`] ?? obj[key];
};

const content = (node: unknown): CommentContent => ({
  uid: pick<string>(node, "block/uid") || "",
  string: pick<string>(node, "block/string") || "",
  children: orderedChildren(node).map(content),
});

const orderedChildren = (node: unknown): unknown[] =>
  [...(pick<unknown[]>(node, "block/children") || [])].sort(
    (a, b) =>
      (pick<number>(a, "block/order") || 0) -
      (pick<number>(b, "block/order") || 0),
  );

export const shapeSource = (node: unknown): DiscussionSource => ({
  uid: pick<string>(node, "block/uid") || "",
  string: pick<string>(node, "block/string") || "",
  order: pick<number>(node, "block/order") || 0,
});

export const shapeComments = (container: unknown): DiscussionComment[] => {
  const parent = (pick<unknown[]>(container, "block/_children") || [])[0];
  const label = pick<string>(parent, "block/string") || "";
  const fallbackAuthor = /^\[\[(.*)\]\]$/.exec(label)?.[1] || "Unknown author";
  return orderedChildren(container).map((node) => ({
    ...content(node),
    author:
      pick<string>(
        pick(pick(node, "create/user"), "user/display-page"),
        "node/title",
      ) || fallbackAuthor,
    time: pick<number>(node, "create/time") || 0,
  }));
};

export const isResolved = (node: unknown): boolean =>
  prop(prop(pick(node, "block/props"), "roam-inbox"), "resolved") === true;

export const resolveDiscussionContext = async (
  uid?: string,
): Promise<DiscussionContext> => {
  const api = window.roamAlphaAPI;
  const target = uid || (await api.ui.mainWindow.getOpenPageOrBlockUid());
  if (!target)
    throw new Error(
      "Open a page, or choose Discuss block from a block’s menu.",
    );
  const pulled = await api.data.async.pull(
    "[:block/uid :block/string :node/title {:block/page [:block/uid :node/title]}]",
    [":block/uid", target],
  );
  if (!pick(pulled, "block/uid"))
    throw new Error("This page or block no longer exists.");
  const title = pick<string>(pulled, "node/title");
  const page = title ? pulled : pick(pulled, "block/page");
  const pageUid = pick<string>(page, "block/uid");
  if (!pageUid)
    throw new Error("Could not find the source page for this block.");
  return {
    pageUid,
    title: pick<string>(page, "node/title") || "Untitled",
    sourceUid: title ? undefined : target,
  };
};

export const fetchDiscussions = async (
  pageUid: string,
): Promise<DiscussionSnapshot> => {
  const api = window.roamAlphaAPI.data.async;
  const [sourceRows, rows] = await Promise.all([
    api.q(Q_PAGE_SOURCES, pageUid),
    api.q(Q_PAGE_COMMENTS, pageUid),
  ]);
  const sources = sourceRows
    .map(([node]) => shapeSource(node))
    .filter((s) => s.uid && s.string.trim());
  const byUid = new Map<string, DiscussionThread>();
  for (const [sourceNode, container] of rows) {
    const source = shapeSource(sourceNode);
    // Only exact native reference containers count, never a prose mention of the source.
    if (pick(container, "block/string") !== `((${source.uid}))`) continue;
    const nodes = new Map(
      orderedChildren(container).map((n) => [pick(n, "block/uid"), n]),
    );
    for (const comment of shapeComments(container)) {
      if (!comment.uid) continue;
      byUid.set(comment.uid, {
        ...comment,
        source,
        resolved: isResolved(nodes.get(comment.uid)),
        replies: [],
      });
    }
  }
  const threads = [...byUid.values()];
  if (threads.length) {
    const replies = await api.q(
      Q_REPLY_COMMENTS,
      threads.map((t) => t.uid),
    );
    for (const [uid, container] of replies) {
      if (
        typeof uid !== "string" ||
        pick(container, "block/string") !== `((${uid}))`
      )
        continue;
      byUid.get(uid)?.replies.push(...shapeComments(container));
    }
  }
  threads.forEach((t) =>
    t.replies.sort((a, b) => a.time - b.time || a.uid.localeCompare(b.uid)),
  );
  threads.sort((a, b) => b.time - a.time || a.uid.localeCompare(b.uid));
  return { sources, threads };
};

type NativeCommentApi = {
  addComment?: (args: {
    "block-uid": string;
    "reply-string": string;
  }) => Promise<unknown>;
};

export const canAddComments = (): boolean =>
  typeof (window.roamAlphaAPI.data.block as NativeCommentApi).addComment ===
  "function";

export const postNativeComment = async ({
  uid,
  text,
  kind,
}: {
  uid: string;
  text: string;
  kind: "thread" | "reply";
}): Promise<void> => {
  if (!text.trim()) throw new Error("Write a comment before posting.");
  const api = window.roamAlphaAPI;
  const add = (api.data.block as NativeCommentApi).addComment;
  if (!add)
    throw new Error(
      "This Roam build does not support native comment creation.",
    );
  const target = await api.data.async.pull("[:block/uid :block/props]", [
    ":block/uid",
    uid,
  ]);
  if (!pick(target, "block/uid"))
    throw new Error("The source block was deleted. Your draft is still here.");
  if (kind === "reply" && isResolved(target))
    throw new Error("This thread was resolved. Reopen it to send your draft.");
  await add({ "block-uid": uid, "reply-string": text.trim() });
};

// Roam returns keywordized map keys; write APIs accept ordinary JavaScript keys.
export const writableProps = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(writableProps);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key.replace(/^:/, ""),
        writableProps(v),
      ]),
    );
  return value;
};

export const setThreadResolved = async ({
  uid,
  resolved,
}: {
  uid: string;
  resolved: boolean;
}): Promise<void> => {
  const api = window.roamAlphaAPI;
  const node = await api.data.async.pull("[:block/uid :block/props]", [
    ":block/uid",
    uid,
  ]);
  if (!pick(node, "block/uid"))
    throw new Error("This discussion no longer exists.");
  const props = record(writableProps(pick(node, "block/props")));
  const metadata = record(props["roam-inbox"]);
  await api.data.block.update({
    block: {
      uid,
      props: {
        ...props,
        "roam-inbox": {
          ...metadata,
          resolved,
          resolvedAt: resolved ? Date.now() : null,
        },
      },
    },
  });
};

export const discussionDraftKey = (uid: string): string =>
  `${graphName()}:${window.roamAlphaAPI.user?.uid?.() || "anonymous"}:${uid}`;
