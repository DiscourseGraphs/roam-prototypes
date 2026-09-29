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

type Pulled = Record<string, unknown>;

const api = () => window.roamAlphaAPI as unknown as RoamApi;

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

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const list = (v: unknown): Pulled[] => (Array.isArray(v) ? (v as Pulled[]) : []);
const byUid = (uid: string) => [":block/uid", uid];

/* ── sharing ───────────────────────────────────────────────────────────── */

type Entry = { at: number; value: Promise<unknown> };
const shared = new Map<string, Entry>();

const fresh = (key: string): Entry | undefined => {
  const hit = shared.get(key);
  return hit && Date.now() - hit.at < SHARE_MS ? hit : undefined;
};

const share = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const hit = fresh(key);
  if (hit) return hit.value as Promise<T>;
  const value = load();
  shared.set(key, { at: Date.now(), value });
  value.catch(() => shared.delete(key));
  return value;
};

/* Like share(), for per-uid values fetched in one batch: uids already in
 * flight are reused, the rest go out in a single pull_many. */
const shareMany = async <T>(
  prefix: string,
  uids: readonly string[],
  load: (uids: string[]) => Promise<Map<string, T>>,
): Promise<Map<string, T>> => {
  const missing = [...new Set(uids)].filter((u) => !fresh(prefix + u));
  if (missing.length) {
    const batch = load(missing);
    const at = Date.now();
    for (const u of missing) {
      const value = batch.then((m) => m.get(u));
      shared.set(prefix + u, { at, value });
      value.catch(() => shared.delete(prefix + u));
    }
  }
  const out = new Map<string, T>();
  await Promise.all(
    uids.map(async (u) => {
      const v = (await shared.get(prefix + u)?.value) as T | undefined;
      if (v !== undefined) out.set(u, v);
    }),
  );
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
  const pageUid = str((b?.[":block/page"] as Pulled | undefined)?.[":block/uid"]);
  if (!pageUid) return null;
  return { pageUid, ancestorUids: list(b?.[":block/parents"]).map((p) => str(p[":block/uid"])) };
};

/* Blocks on the page that reference a daily-note page.
 *
 * Fast path: start from the `.sticky` tag's reverse references (~2,300 blocks
 * graph-wide in dg-team, ~35 ms) instead of scanning every block on the page
 * (~170 ms on All Hands). model.selectMeetings only keeps #.sticky meetings
 * when any exist, so this returns the same meetings. A page with no #.sticky
 * meetings falls back to the page scan. */
export const readMeetingRows = (pageUid: string): Promise<MeetingRow[]> =>
  share(`meetings:${pageUid}`, async () => {
    const tag = await api().data.async.pull(
      "[{(:block/_refs :limit nil) [:block/uid :block/string {:block/page [:block/uid]} {:block/refs [:block/uid :log/id]}]}]",
      [":node/title", ".sticky"],
    );
    const sticky = list(tag?.[":block/_refs"])
      .filter((b) => str((b[":block/page"] as Pulled | undefined)?.[":block/uid"]) === pageUid)
      .flatMap((b) =>
        list(b[":block/refs"])
          .filter((r) => r[":log/id"] !== undefined)
          .map((r) => ({
            uid: str(b[":block/uid"]),
            string: str(b[":block/string"]),
            dailyNoteUid: str(r[":block/uid"]),
            sticky: true,
          })),
      );
    if (sticky.length) return sticky;

    // Tuple order: [meeting uid, meeting string, daily-note uid]
    const rows = await api().data.async.q(
      `[:find ?mu ?ms ?du :in $ ?pgu :where
        [?pg :block/uid ?pgu] [?m :block/page ?pg]
        [?m :block/refs ?d] [?d :log/id _] [?d :block/uid ?du]
        [?m :block/uid ?mu] [?m :block/string ?ms]]`,
      pageUid,
    );
    return rows.map(([uid, string, dailyNoteUid]) => ({
      uid: str(uid),
      string: str(string),
      dailyNoteUid: str(dailyNoteUid),
      sticky: str(string).includes(".sticky"),
    }));
  });

const toTree = (b: Pulled): TreeNode => ({
  uid: str(b[":block/uid"]),
  string: str(b[":block/string"]),
  time: num(b[":edit/time"]),
  children: list(b[":block/children"]).map(toTree),
});

/* Whole subtrees of the given meeting blocks, in one pull_many. On All Hands
 * the 18 meetings in a 120-day window are ~2,200 blocks and ~45 ms. */
export const readTrees = async (uids: readonly string[]): Promise<TreeNode[]> => {
  const got = await shareMany("tree:", uids, async (missing) => {
    const pulled = await api().data.async.pull_many(
      "[:block/uid :block/string :edit/time {:block/children ...}]",
      missing.map(byUid),
    );
    return new Map(pulled.filter((b): b is Pulled => !!b).map((b) => [str(b[":block/uid"]), toTree(b)]));
  });
  return uids.map((u) => got.get(u)).filter((t): t is TreeNode => !!t);
};

/* Every TODO/DONE block on the page, with its ancestors.
 *
 * Starts from the TODO and DONE pages' reverse references, since every
 * checkbox references one of them, and keeps the ones on this page. Then one
 * pull_many for their text and ancestors, which replaces a query that joined
 * every task against every meeting. */
export const readPageTasks = (pageUid: string): Promise<PageTask[]> =>
  share(`tasks:${pageUid}`, async () => {
    const markers = await Promise.all(
      ["TODO", "DONE"].map((title) =>
        api().data.async.pull(
          "[{(:block/_refs :limit nil) [:block/uid {:block/page [:block/uid]}]}]",
          [":node/title", title],
        ),
      ),
    );
    const uids = [
      ...new Set(
        markers.flatMap((m) =>
          list(m?.[":block/_refs"])
            .filter((b) => str((b[":block/page"] as Pulled | undefined)?.[":block/uid"]) === pageUid)
            .map((b) => str(b[":block/uid"])),
        ),
      ),
    ];
    if (!uids.length) return [];
    const pulled = await api().data.async.pull_many(
      "[:block/uid :block/string :edit/time {:block/parents [:block/uid]}]",
      uids.map(byUid),
    );
    return pulled
      .filter((b): b is Pulled => !!b)
      .map((b) => ({
        uid: str(b[":block/uid"]),
        string: str(b[":block/string"]),
        time: num(b[":edit/time"]),
        parentUids: list(b[":block/parents"]).map((p) => str(p[":block/uid"])),
      }));
  });

/* Text of the given blocks, for resolving ((refs)). One pull_many per call. */
export const readBlocks = (uids: readonly string[]): Promise<Map<string, Block>> =>
  shareMany("block:", uids, async (missing) => {
    const pulled = await api().data.async.pull_many(
      "[:block/uid :block/string :edit/time]",
      missing.map(byUid),
    );
    return new Map(
      pulled
        .filter((b): b is Pulled => !!b)
        .map((b) => [
          str(b[":block/uid"]),
          { uid: str(b[":block/uid"]), string: str(b[":block/string"]), time: num(b[":edit/time"]) },
        ]),
    );
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
