/* Every read and write of the graph, through the namespaced async API.
 *
 * Datalog inputs are parameterized through `:in`, never interpolated. Pull
 * results are read through `pick`, which tries the namespaced key first: on
 * some API surfaces the short key does not come back undefined but resolves
 * to a ClojureScript internal, and short-first silently yields garbage that
 * looks like an empty graph.
 */
import { ACTIVE_WITHIN_DAYS, EXCLUDE_PATTERNS, logError } from "~/config";

const api = () => window.roamAlphaAPI;

const q = (query: string, ...params: unknown[]): Promise<unknown[][]> =>
  api().data.async.q(query, ...params);

/* Read one attribute off a pulled entity, namespaced key first. */
export const pick = <T = unknown>(obj: unknown, attr: string): T | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, T | null | undefined>;
  const bare = attr.slice(attr.indexOf("/") + 1);
  return rec[`:${attr}`] ?? rec[bare] ?? undefined;
};

// ------------------------------------------------------------------ identity

export type Identity = { uid: string; name: string };

/* The signed-in user, by display-page title. Null when there is no display
 * page: the badge cannot work without one, though /message still can. */
export const currentUser = async (): Promise<Identity | null> => {
  const uid = api().user?.uid?.();
  if (!uid) return null;
  const rows = await q(
    "[:find ?t :in $ ?uid :where [?u :user/uid ?uid] [?u :user/display-page ?p] [?p :node/title ?t]]",
    uid,
  );
  const name = rows?.[0]?.[0];
  return typeof name === "string" && name ? { uid, name } : null;
};

export const graphName = (): string => api().graph?.name || "graph";

// ------------------------------------------------------------------ messages

export type Message = {
  uid: string;
  string: string;
  time: number; // :create/time, the block's birthday, NOT when it was addressed
  todo: boolean; // carries an open checkbox
  authorUid: string | null;
  author: string | null;
  page: string;
  parent: string; // the direct parent's text, or the page title when top-level
};

/* `:block/_children` is the direct parent only; `:block/parents` would pull
 * every ancestor's text and the panel shows one. */
const PULL = `[:block/uid :block/string :create/time
  {:block/refs [:node/title]}
  {:create/user [:user/uid {:user/display-page [:node/title]}]}
  {:block/page [:node/title]}
  {:block/_children [:block/string :node/title]}]`;

const OPEN_REFS = `[?p :node/title ?title] [?b :block/refs ?p]
  (not-join [?b] [?done :node/title "DONE"] [?b :block/refs ?done])`;

/* Blocks that reference the page titled ?title and are not checked off. For
 * `+Name` these are Name's messages (with a TODO) and mentions (without),
 * told apart in JS from the pulled refs. Each row is [pulled block]. */
export const Q_OPEN_REFS = `[:find (pull ?b ${PULL}) :in $ ?title :where ${OPEN_REFS}]`;

/* The same, restricted to open TODOs. For `Name` this is the /task channel
 * (`#[[Name]]`); a person's display page is referenced far more often than
 * their `+Name` page, so the checkbox filter stays in the query. */
export const Q_OPEN_TODOS = `[:find (pull ?b ${PULL}) :in $ ?title :where ${OPEN_REFS}
  [?todo :node/title "TODO"] [?b :block/refs ?todo]]`;

export const shape = (row: unknown[]): Message => {
  const b = row[0];
  const user = pick(b, "create/user");
  const displayPage = pick(user, "user/display-page");
  const refs = pick<unknown[]>(b, "block/refs") || [];
  const parent = (pick<unknown[]>(b, "block/_children") || [])[0];
  return {
    uid: pick<string>(b, "block/uid") || "",
    string: pick<string>(b, "block/string") || "",
    time: pick<number>(b, "create/time") || 0,
    todo: refs.some((r) => pick<string>(r, "node/title") === "TODO"),
    authorUid: pick<string>(user, "user/uid") || null,
    author: pick<string>(displayPage, "node/title") || null,
    page: pick<string>(pick(b, "block/page"), "node/title") || "",
    parent: pick<string>(parent, "block/string") || pick<string>(parent, "node/title") || "",
  };
};

/* Newest first. A failed query is an empty list, not a crash: the badge
 * would rather show nothing than take the topbar down with it. */
export const fetchList = async (query: string, title: string): Promise<Message[]> => {
  try {
    return ((await q(query, title)) || [])
      .map(shape)
      .filter((m) => m.uid)
      .sort((a, b) => b.time - a.time);
  } catch (e) {
    logError("query failed", e);
    return [];
  }
};

// ------------------------------------------------------------------- members

const isExcluded = (name: string): boolean => EXCLUDE_PATTERNS.some((re) => re.test(name));

/* Every display-page title in the graph, alphabetical. */
export const allMembers = async (): Promise<string[]> => {
  const rows = await q("[:find (pull ?n [:node/title]) :where [?u :user/display-page ?n]]");
  return (rows || [])
    .map((row) => pick<string>(row[0], "node/title") || "")
    .filter((name) => name && !isExcluded(name))
    .sort((a, b) => a.localeCompare(b));
};

// Tuple order: [display-page title, that user's most recent edit time].
const ACTIVITY_QUERY =
  "[:find ?name (max ?time) :where " +
  "[?u :user/display-page ?p] [?p :node/title ?name] " +
  "[?b :edit/user ?u] [?b :edit/time ?time]]";

/* Members who edited something within ACTIVE_WITHIN_DAYS, most recent first.
 * This scans every block's edit time, so it runs on the backend (off the
 * main thread) where that surface exists. */
export const recentlyActiveMembers = async (): Promise<string[]> => {
  const backend = api().data.backend;
  const rows = backend?.q ? await backend.q(ACTIVITY_QUERY) : await q(ACTIVITY_QUERY);
  const since = Date.now() - ACTIVE_WITHIN_DAYS * 24 * 60 * 60 * 1000;
  return (rows || [])
    .map(([name, last]) => ({ name: typeof name === "string" ? name : "", last: Number(last) || 0 }))
    .filter((r) => r.name && !isExcluded(r.name) && r.last >= since)
    .sort((a, b) => b.last - a.last)
    .map((r) => r.name);
};

// --------------------------------------------------------- pages and blocks

const pageUid = async (title: string): Promise<string> =>
  pick<string>(
    (await q("[:find (pull ?p [:block/uid]) :in $ ?t :where [?p :node/title ?t]]", title))?.[0]?.[0],
    "block/uid",
  ) || "";

/* A first-time recipient has no `+Name` page, which makes them silently
 * unmessageable and leaves the pull watch with no entity to bind to. */
export const ensurePage = async (title: string): Promise<void> => {
  if (await pageUid(title)) return;
  await api().data.page.create({ page: { title } });
};

export const blockString = async (uid: string): Promise<string> =>
  pick<string>(await api().data.async.pull("[:block/string]", [":block/uid", uid]), "block/string") ||
  "";

export const updateBlock = (uid: string, string: string): Promise<void> =>
  api().data.block.update({ block: { uid, string } });

/* Appends a child and returns its uid, which the caller needs to focus it. */
export const createChildBlock = async (parentUid: string, string: string): Promise<string> => {
  const uid = api().util.generateUID();
  await api().data.block.create({
    location: { "parent-uid": parentUid, order: "last" },
    block: { uid, string },
  });
  return uid;
};

export const openInSidebar = async (uid: string): Promise<void> => {
  const sidebar = api().ui.rightSidebar;
  await sidebar.addWindow({ window: { type: "block", "block-uid": uid } });
  if (sidebar.open) await sidebar.open();
};

export const focusBlock = (uid: string, windowId?: string, start?: number): Promise<void> =>
  api().ui.setBlockFocusAndSelection({
    // Roam accepts a missing window id; the typing does not.
    location: { "block-uid": uid, "window-id": windowId } as { "block-uid": string; "window-id": string },
    ...(start === undefined ? {} : { selection: { start } }),
  });

// ---------------------------------------------------------------- pull watch

/* The entity for addPullWatch is an EDN lookup ref built from text. There is
 * no `:in` for pull watches, so the title is quoted as a JSON string, which
 * is also a valid EDN string for every title Roam allows. */
export const pullWatchEntity = (title: string): string => `[:node/title ${JSON.stringify(title)}]`;

/* Fires when any block starts or stops referencing the page. Returns the
 * disposer. */
export const watchReferencesTo = (title: string, callback: () => void): (() => void) => {
  const pattern = "[{:block/_refs [:block/uid]}]";
  const entity = pullWatchEntity(title);
  api().data.addPullWatch(pattern, entity, callback);
  return () => {
    api().data.removePullWatch(pattern, entity, callback);
  };
};

// ------------------------------------------------------------- slash command

/* `ui.slashCommand` is real but undocumented, so it is absent from the
 * roamjs-components typings. The callback's return value replaces the typed
 * "/message..." text; returning "" deletes it. */
export type SlashContext = { "block-uid"?: string; "window-id"?: string };
type SlashCommandApi = {
  addCommand: (command: { label: string; callback: (ctx: SlashContext) => string }) => void;
  removeCommand: (command: { label: string }) => void;
};

/* Returns the disposer, or null when this Roam build has no slash-command API. */
export const registerSlashCommand = (
  label: string,
  callback: (ctx: SlashContext) => string,
): (() => void) | null => {
  const slash = (api().ui as unknown as { slashCommand?: SlashCommandApi }).slashCommand;
  if (!slash?.addCommand) return null;
  slash.addCommand({ label, callback });
  return () => slash.removeCommand({ label });
};
