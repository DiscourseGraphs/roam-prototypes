/* Every graph read and write, and nothing else.
 *
 * Reads use the promise-returning `data.async.*` API and run after the widget
 * has rendered, never during render. They are direct lookups (pull,
 * pull_many, reverse references) wherever possible. Datalog queries that
 * bind a variable from an earlier clause or from a list make DataScript scan
 * the whole attribute: on dg-team's All Hands page (26,728 blocks) the old
 * component spent 1.6-2.0 s per widget that way, synchronously, and a page
 * mounts several widgets.
 *
 * Page-wide reads are shared: every widget on a page asks for the same data
 * at nearly the same moment, and only the first one actually reads.
 */
import { SHARE_MS } from "~/config";
import type { Block, MeetingRow, PageTask, TreeNode } from "~/model";
import { isSticky } from "~/text";

type Pulled = Record<string, unknown>;

// roamjs-components declares these too, but types pull_many ids as uid pairs
// only, and entity ids are what makes refsOnPage cheap.
type RoamApi = {
  graph?: { name?: string };
  data: {
    async: {
      q: (query: string, ...inputs: unknown[]) => Promise<unknown[][]>;
      pull: (pattern: string, eid: unknown) => Promise<Pulled | null>;
      pull_many: (pattern: string, eids: unknown[]) => Promise<(Pulled | null)[]>;
    };
    block: { update: (args: { block: { uid: string; string: string } }) => Promise<void> };
  };
  ui: {
    rightSidebar: {
      addWindow: (args: { window: { type: "block"; "block-uid": string } }) => Promise<void>;
      open: () => Promise<void>;
    };
  };
};

const api = () => window.roamAlphaAPI as unknown as RoamApi;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const list = (v: unknown): Pulled[] => (Array.isArray(v) ? (v as Pulled[]) : []);
const uidOf = (v: unknown): string => str((v as Pulled | undefined)?.[":block/uid"]);
const byUid = (uid: string) => [":block/uid", uid];

const toBlock = (b: Pulled): Block => ({
  uid: uidOf(b),
  string: str(b[":block/string"]),
  time: num(b[":edit/time"]),
});

const pullMany = async (pattern: string, eids: readonly unknown[]): Promise<Pulled[]> =>
  eids.length
    ? (await api().data.async.pull_many(pattern, [...eids])).filter((b): b is Pulled => !!b)
    : [];

/* ── sharing ───────────────────────────────────────────────────────────── */

type Entry = { at: number; value: Promise<unknown> };
const shared = new Map<string, Entry>();

const fresh = (key: string): Entry | undefined => {
  const hit = shared.get(key);
  return hit && Date.now() - hit.at < SHARE_MS ? hit : undefined;
};

/* Entries leave the map when they expire or fail, so a session of browsing
 * does not keep every page's trees alive. */
const put = (key: string, value: Promise<unknown>): void => {
  const entry = { at: Date.now(), value };
  shared.set(key, entry);
  const drop = () => shared.get(key) === entry && shared.delete(key);
  value.catch(drop);
  window.setTimeout(drop, SHARE_MS);
};

const share = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const hit = fresh(key);
  if (hit) return hit.value as Promise<T>;
  const value = load();
  put(key, value);
  return value;
};

/* Like share(), for per-uid values fetched in one batch: uids already in
 * flight are reused, the rest go out in a single pull_many. */
const shareMany = async <T>(
  prefix: string,
  uids: readonly string[],
  load: (uids: string[]) => Promise<Map<string, T>>,
): Promise<Map<string, T>> => {
  const entries = new Map(uids.map((u) => [u, fresh(prefix + u)?.value]));
  const missing = [...entries].filter(([, v]) => !v).map(([u]) => u);
  if (missing.length) {
    const batch = load(missing);
    for (const u of missing) {
      const value = batch.then((m) => m.get(u));
      put(prefix + u, value);
      entries.set(u, value);
    }
  }
  const out = new Map<string, T>();
  for (const [u, value] of entries) {
    const v = (await value) as T | undefined;
    if (v !== undefined) out.set(u, v);
  }
  return out;
};

/* After a write, anything read before it may be stale. */
export const forgetReads = (): void => shared.clear();

/* ── reads ─────────────────────────────────────────────────────────────── */

export const graphName = (): string => api().graph?.name ?? "";

/* The widget's page and every ancestor block, in one direct read. */
export const readHost = async (
  uid: string,
): Promise<{ pageUid: string; ancestorUids: string[] } | null> => {
  const b = await api().data.async.pull(
    "[{:block/page [:block/uid]} {:block/parents [:block/uid]}]",
    byUid(uid),
  );
  const pageUid = uidOf(b?.[":block/page"]);
  if (!pageUid) return null;
  return { pageUid, ancestorUids: list(b?.[":block/parents"]).map(uidOf) };
};

/* Blocks on one page that reference the page titled `title`, pulled with
 * `pattern`. Starts from the title's reverse references, an index read, and
 * compares entity ids, so only the blocks on this page are pulled in full.
 * On dg-team this is 3-6x cheaper than pulling every reference by uid. */
const refsOnPage = async (title: string, pageUid: string, pattern: string): Promise<Pulled[]> => {
  const [page, target] = await Promise.all([
    share(`page:${pageUid}`, () => api().data.async.pull("[:db/id]", byUid(pageUid))),
    api().data.async.pull("[{(:block/_refs :limit nil) [:db/id :block/page]}]", [":node/title", title]),
  ]);
  const pageEid = page?.[":db/id"];
  if (pageEid === undefined) return [];
  const eids = list(target?.[":block/_refs"])
    .filter((b) => (b[":block/page"] as Pulled | undefined)?.[":db/id"] === pageEid)
    .map((b) => b[":db/id"]);
  return pullMany(pattern, eids);
};

/* Blocks on the page that reference a daily-note page.
 *
 * Fast path: start from the `.sticky` tag's reverse references instead of
 * scanning every block on the page (~170 ms on All Hands). selectMeetings
 * keeps only #.sticky meetings when any exist, so when this finds some it has
 * found every meeting that counts. A page with none falls back to the scan. */
export const readMeetingRows = (pageUid: string): Promise<MeetingRow[]> =>
  share(`meetings:${pageUid}`, async () => {
    const tagged = await refsOnPage(
      ".sticky",
      pageUid,
      "[:block/uid :block/string {:block/refs [:block/uid :log/id]}]",
    );
    const rows = tagged.flatMap((b) =>
      list(b[":block/refs"])
        .filter((r) => r[":log/id"] !== undefined)
        .map((r) => [uidOf(b), str(b[":block/string"]), uidOf(r)]),
    );
    const found = rows.length
      ? rows
      : // Tuple order: [meeting uid, meeting string, daily-note uid]
        await api().data.async.q(
          `[:find ?mu ?ms ?du :in $ ?pgu :where
            [?pg :block/uid ?pgu] [?m :block/page ?pg]
            [?m :block/refs ?d] [?d :log/id _] [?d :block/uid ?du]
            [?m :block/uid ?mu] [?m :block/string ?ms]]`,
          pageUid,
        );
    return found.map(([uid, string, dailyNoteUid]) => ({
      uid: str(uid),
      string: str(string),
      dailyNoteUid: str(dailyNoteUid),
      sticky: isSticky(str(string)),
    }));
  });

// Pulled children come back in no particular order; :block/order is the
// outline position.
const toTree = (b: Pulled): TreeNode => ({
  ...toBlock(b),
  children: list(b[":block/children"])
    .sort((x, y) => num(x[":block/order"]) - num(y[":block/order"]))
    .map(toTree),
});

/* Blocks with their descendants, `depth` levels deep (all of them when
 * omitted), in one pull_many. Meetings are read two levels deep, which is
 * where headers live; only the headers are then read in full. */
export const readTrees = async (uids: readonly string[], depth?: number): Promise<TreeNode[]> => {
  const levels = depth ?? "...";
  const got = await shareMany(`tree${levels}:`, uids, async (missing) => {
    const pulled = await pullMany(
      `[:block/uid :block/string :block/order :edit/time {:block/children ${levels}}]`,
      missing.map(byUid),
    );
    return new Map(pulled.map((b) => [uidOf(b), toTree(b)]));
  });
  return uids.map((u) => got.get(u)).filter((t): t is TreeNode => !!t);
};

/* Every TODO/DONE block on the page, with its ancestors. Every checkbox
 * references the TODO or DONE page, so this is two refsOnPage reads. */
export const readPageTasks = (pageUid: string): Promise<PageTask[]> =>
  share(`tasks:${pageUid}`, async () => {
    const pattern = "[:block/uid :block/string :edit/time {:block/parents [:block/uid]}]";
    const [todo, done] = await Promise.all(
      ["TODO", "DONE"].map((title) => refsOnPage(title, pageUid, pattern)),
    );
    return todo.concat(done).map((b) => ({
      ...toBlock(b),
      parentUids: list(b[":block/parents"]).map(uidOf),
    }));
  });

/* Text of the given blocks, for resolving ((refs)). One pull_many per call. */
export const readBlocks = (uids: readonly string[]): Promise<Map<string, Block>> =>
  shareMany("block:", uids, async (missing) => {
    const pulled = await pullMany("[:block/uid :block/string :edit/time]", missing.map(byUid));
    return new Map(pulled.map((b) => [uidOf(b), toBlock(b)]));
  });

/* ── writes ────────────────────────────────────────────────────────────── */

export const writeString = async (uid: string, string: string): Promise<void> => {
  await api().data.block.update({ block: { uid, string } });
  forgetReads();
};

export const openInSidebar = async (uid: string): Promise<void> => {
  await api().ui.rightSidebar.addWindow({ window: { type: "block", "block-uid": uid } });
  await api().ui.rightSidebar.open();
};
