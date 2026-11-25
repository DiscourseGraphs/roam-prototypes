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
  summary?: boolean;
  replies: DiscussionComment[];
};
export type DiscussionContext = {
  pageUid: string;
  title: string;
  sourceUid?: string;
  threadUid?: string;
  outlineUid?: string;
  outlineTitle?: string;
  nativeStorage?: boolean;
  ancestors?: string[];
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
const SOURCE_CONTAINERS = `${COMMENT_REFERENCE}
  (not-join [?source] [?source :block/parents ?root] [?root :block/string "[[roam/comments]]"])`;

// Start from the small native storage tree, then constrain its referenced source.
const FROM_COMMENTS = `[?comments :block/string "[[roam/comments]]"]
  [?comments :block/children ?date] [?date :block/children ?author]
  [?author :block/children ?container] [?container :block/refs ?source]`;
const ORDINARY_SOURCE = `(not-join [?source] [?source :block/parents ?root]
  [?root :block/string "[[roam/comments]]"])`;
const OUTLINE = `(or [(identity ?scope) ?source] [?source :block/parents ?scope])`;
const EXACT_REFERENCE = `[?source :block/uid ?sourceUid] [(str "((" ?sourceUid "))") ?exact]
  [?container :block/string ?exact]`;
const SUMMARY_CONTAINER = `[:block/string {:block/_children [:block/string]}
  {:block/children [:block/uid :block/order :block/props :create/time
  {:create/user [{:user/display-page [:node/title]}]}]}]`;
const FIND = `[:find (pull ?source [:block/uid])
  (pull ?container ${SUMMARY_CONTAINER}) :in $ ?uid :where [?scope :block/uid ?uid]`;
export const Q_PAGE_COMMENTS = `${FIND} ${FROM_COMMENTS} [?source :block/page ?scope] ${ORDINARY_SOURCE} ${EXACT_REFERENCE}]`;
export const Q_OUTLINE_COMMENTS = `${FIND} ${OUTLINE} ${SOURCE_CONTAINERS} ${EXACT_REFERENCE}]`;
export const Q_INLINE_COMMENTS = `[:find (pull ?source [:block/uid :block/string :block/order])
  (pull ?container ${CONTAINER}) :in $ ?uid :where [?source :block/uid ?uid] ${SOURCE_CONTAINERS} ${EXACT_REFERENCE}]`;

const Q_BADGES = `[:find ?uid ?reference (count-distinct ?thread) :in $ [?uid ...]
  :where [?source :block/uid ?uid] ${SOURCE_CONTAINERS}
  [?container :block/string ?reference] [?container :block/children ?thread]]`;

export const existingBlockUids = async (candidates: string[]) => {
  const rows = await window.roamAlphaAPI.data.async.q(
    "[:find ?uid :in $ [?uid ...] :where [?b :block/uid ?uid]]",
    candidates,
  );
  return rows.map(([uid]) => String(uid));
};

export const fetchBadgeCounts = async (
  uids: string[],
): Promise<Map<string, number>> => {
  const rows = uids.length
    ? await window.roamAlphaAPI.data.async.q(Q_BADGES, uids)
    : [];
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
  ${COMMENT_REFERENCE} ${EXACT_REFERENCE}]`;

// Source selection is a separate, user-initiated read. Start at the scope's
// immediate children; typing a search also finds deeply nested source blocks.
export const findDiscussionSources = async (
  context: DiscussionContext,
  search: string,
) => {
  const scopeUid = context.outlineUid || context.pageUid;
  const membership = context.outlineUid
    ? OUTLINE
    : "[?source :block/page ?scope]";
  const children = context.outlineUid
    ? "(or [(identity ?scope) ?source] [?scope :block/children ?source])"
    : "[?scope :block/children ?source]";
  const candidates = search ? membership : children;
  const query = `[:find (min 50 ?option) :in $ ?root ?term :where
    [?scope :block/uid ?root] ${candidates} [?source :block/string ?text]
    [?source :block/uid ?uid] [(get-else $ ?source :block/order 0) ?order]
    [(re-pattern ?term) ?pattern] [(re-find ?pattern ?text)]
    (not [?source :block/string "[[roam/comments]]"]) ${ORDINARY_SOURCE}
    [(tuple ?order ?uid ?text) ?option]]`;
  const literal = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await window.roamAlphaAPI.data.async.q(
    query,
    scopeUid,
    search ? "(?i)" + literal : "\\S",
  );
  const options = (rows[0]?.[0] || []) as [number, string, string][];
  const sources = options.map(([order, uid, string]) => ({
    uid,
    string,
    order,
  }));
  if (
    !search &&
    context.sourceUid &&
    !sources.some((source) => source.uid === context.sourceUid)
  ) {
    // Discuss block can target a deep block that has never had a thread.
    const exact = await window.roamAlphaAPI.data.async.q(
      `[:find (pull ?source [:block/uid :block/string :block/order]) :in $ ?root ?uid :where
        [?scope :block/uid ?root] [?source :block/uid ?uid] ${membership}
        [?source :block/string ?text] (not [?source :block/string "[[roam/comments]]"]) ${ORDINARY_SOURCE}]`,
      scopeUid,
      context.sourceUid,
    );
    if (exact.length) {
      const source = shapeSource(exact[0][0]);
      if (source.string.trim()) sources.unshift(source);
    }
  }
  return sources;
};

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
    "[:block/uid :block/string :node/title {:block/parents [:block/uid :block/string]} {:block/page [:block/uid :node/title]}]",
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
    nativeStorage: pick<unknown[]>(pulled, "block/parents")?.some(
      (parent) => pick(parent, "block/string") === "[[roam/comments]]",
    ),
    ancestors: pick<unknown[]>(pulled, "block/parents")?.map(
      (n) => pick<string>(n, "block/uid") || "",
    ),
    outlineTitle: title ? undefined : pick<string>(pulled, "block/string"),
  };
};

const readDiscussions = async (
  uid: string,
  scope: "page" | "outline" | "inline" = "page",
): Promise<DiscussionSnapshot> => {
  const api = window.roamAlphaAPI.data.async;
  const query =
    scope === "inline"
      ? Q_INLINE_COMMENTS
      : scope === "outline"
        ? Q_OUTLINE_COMMENTS
        : Q_PAGE_COMMENTS;
  const rows = await api.q(query, uid);
  const sources = new Map<string, DiscussionSource>();
  const byUid = new Map<string, DiscussionThread>();
  for (const [sourceNode, container] of rows) {
    const source = shapeSource(sourceNode);
    // Only exact native reference containers count, never a prose mention of the source.
    if (pick(container, "block/string") !== `((${source.uid}))`) continue;
    sources.set(source.uid, source);
    const nodes = new Map(
      orderedChildren(container).map((n) => [pick(n, "block/uid"), n]),
    );
    for (const comment of shapeComments(container)) {
      if (!comment.uid) continue;
      byUid.set(comment.uid, {
        ...comment,
        source,
        summary: scope !== "inline",
        resolved: isResolved(nodes.get(comment.uid)),
        replies: [],
      });
    }
  }
  const threads = [...byUid.values()];
  if (threads.length) {
    const replies = await api.q(
      scope === "inline" ? Q_REPLY_COMMENTS : Q_REPLY_IDS,
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
  return { sources: [...sources.values()], threads };
};

const Q_REPLY_IDS = `[:find ?uid (pull ?container [:block/string {:block/children [:block/uid]}])
  :in $ [?uid ...] :where [?source :block/uid ?uid] ${COMMENT_REFERENCE} ${EXACT_REFERENCE}]`;

// Coalesce concurrent reads only. Subsequent refreshes must see remote edits.
const pending = new Map<string, Promise<DiscussionSnapshot>>();
export const fetchDiscussions = (
  uid: string,
  scope: "page" | "outline" | "inline" = "page",
) => {
  const key = JSON.stringify([graphName(), scope, uid]);
  const existing = pending.get(key);
  if (existing) return existing;
  const read = readDiscussions(uid, scope).finally(() => pending.delete(key));
  pending.set(key, read);
  return read;
};

export const loadDiscussionLabels = async (uids: string[]) => {
  const rows = await window.roamAlphaAPI.data.async.q(
    "[:find ?uid ?text :in $ [?uid ...] :where [?b :block/uid ?uid] [?b :block/string ?text]]",
    uids,
  );
  return new Map(rows.map(([uid, text]) => [String(uid), String(text)]));
};

export const loadThreadContent = async (uid: string) => {
  const api = window.roamAlphaAPI.data.async;
  const [node, rows] = await Promise.all([
    api.pull(CONTENT, [":block/uid", uid]),
    api.q(Q_REPLY_COMMENTS, [uid]),
  ]);
  return {
    children: content(node).children,
    replies: rows
      .filter(([, c]) => pick(c, "block/string") === `((${uid}))`)
      .flatMap(([, c]) => shapeComments(c))
      .sort((a, b) => a.time - b.time || a.uid.localeCompare(b.uid)),
  };
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
