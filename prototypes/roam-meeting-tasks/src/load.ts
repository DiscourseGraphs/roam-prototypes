/* One widget's load: read what it needs (roam.ts), then decide what it shows
 * (model.ts). Nothing here renders. */
import type { WidgetArgs } from "~/args";
import { ANCHOR_UIDS, MAX_REF_HOPS } from "~/config";
import { deriveView, findHeaders, headerItems, planWindow, selectMeetings, type Block, type View } from "~/model";
import { readBlocks, readHost, readMeetingRows, readPageTasks, readTrees } from "~/roam";
import { displayRefUids, wrapperRef } from "~/text";

export type Loaded =
  | { kind: "view"; view: View; refs: Map<string, Block>; ms: number }
  | { kind: "empty"; reason: string; ms: number };

const pageUidFromLocation = (): string | null =>
  /\/page\/([\w-]+)/.exec(window.location.hash || "")?.[1] ?? null;

/* The blocks `strings` lead to, one read per hop: `refsOf` names the refs to
 * follow in a string, and the blocks read in one round supply the next
 * round's strings. Stops after MAX_REF_HOPS rounds, so a cycle cannot loop. */
const readRefChain = async (
  strings: readonly string[],
  refsOf: (s: string) => string[],
): Promise<Map<string, Block>> => {
  const found = new Map<string, Block>();
  let frontier = strings;
  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    const want = [...new Set(frontier.flatMap(refsOf))].filter((u) => !found.has(u));
    if (!want.length) break;
    const got = await readBlocks(want);
    if (!got.size) break;
    for (const [uid, b] of got) found.set(uid, b);
    frontier = [...got.values()].map((b) => b.string);
  }
  return found;
};

/* Every block the display text of `strings` needs, refs inside refs included. */
export const readDisplayRefs = (strings: readonly string[]) => readRefChain(strings, displayRefUids);

const wrapperRefs = (s: string): string[] => {
  const uid = wrapperRef(s);
  return uid ? [uid] : [];
};

export const loadWidget = async (args: WidgetArgs, now = Date.now()): Promise<Loaded> => {
  // Wall time from the first read to the last, shown by the `debug` flag.
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const empty = (reason: string): Loaded => ({ kind: "empty", reason, ms: ms() });

  const host = args.hostUid ? await readHost(args.hostUid) : null;
  const pageUid = host?.pageUid ?? pageUidFromLocation();
  if (!pageUid) return empty("no page uid");

  const meetings = selectMeetings(await readMeetingRows(pageUid));
  if (!meetings.length) return empty("no meetings found");

  const plan = planWindow({
    meetings,
    hostAncestorUids: host?.ancestorUids ?? [],
    forcePage: args.forcePage,
    lookbackDays: args.lookbackDays,
    now,
  });
  if (!plan.scan.length) return empty(`no meetings within ${args.lookbackDays} days`);

  // Headers live one or two levels under a meeting, so meetings are read two
  // levels deep and only the headers in full.
  const [tops, pageTasks] = await Promise.all([
    readTrees(plan.scan.map((m) => m.uid), 2),
    readPageTasks(pageUid),
  ]);
  const found = findHeaders(tops, ANCHOR_UIDS);
  const full = new Map((await readTrees(found.map((h) => h.node.uid))).map((t) => [t.uid, t]));
  const headers = found.map((h) => ({ ...h, node: full.get(h.node.uid) ?? h.node }));

  const wrapped = await readRefChain(
    headerItems(headers).map((i) => i.block.string),
    wrapperRefs,
  );
  const view = deriveView({
    pageUid,
    meetings,
    plan,
    headers,
    pageTasks,
    lookupBlock: (uid) => wrapped.get(uid),
    now,
  });
  if (!view.primary.length && !view.secondary.length) return empty(`nothing to show. ${view.debug}`);

  // Only the visible section's refs. The collapsed section reads its own
  // when it is opened.
  const refs = await readDisplayRefs(view.primary.map((r) => r.shown));
  return { kind: "view", view, refs, ms: ms() };
};
