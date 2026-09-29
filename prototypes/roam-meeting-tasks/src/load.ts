/* One widget's load: read what it needs (roam.ts), then decide what it shows
 * (model.ts). Nothing here renders. */
import type { WidgetArgs } from "~/args";
import { ANCHOR_UID, CELEBRATE_DAYS, MAX_REF_HOPS } from "~/config";
import {
  deriveView,
  findHeaders,
  headerItems,
  pendingWrapperTargets,
  planWindow,
  selectMeetings,
  type Block,
  type View,
} from "~/model";
import { readBlocks, readHost, readMeetingRows, readPageTasks, readTrees } from "~/roam";
import { refUids } from "~/text";

export type Loaded =
  | { kind: "view"; view: View; texts: Map<string, string>; ms: number }
  | { kind: "empty"; reason: string; ms: number };

const pageUidFromLocation = (): string | null =>
  /\/page\/([\w-]+)/.exec(window.location.hash || "")?.[1] ?? null;

/* Text of every block referenced from `strings`, following refs inside those
 * blocks too, so display text can be resolved without further reads. */
export const readRefTexts = async (
  strings: readonly string[],
  into: Map<string, string> = new Map(),
): Promise<Map<string, string>> => {
  let frontier = strings;
  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    const want = [...new Set(frontier.flatMap(refUids))].filter((u) => !into.has(u));
    if (!want.length) break;
    const got = await readBlocks(want);
    for (const [uid, b] of got) into.set(uid, b.string);
    frontier = [...got.values()].map((b) => b.string);
  }
  return into;
};

export const loadWidget = async (args: WidgetArgs, now = Date.now()): Promise<Loaded> => {
  // Wall time from the first read to the last, shown by the `debug` flag.
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const empty = (reason: string): Loaded => ({ kind: "empty", reason, ms: ms() });

  const host = args.hostUid ? await readHost(args.hostUid) : null;
  const pageUid = host?.pageUid ?? pageUidFromLocation();
  if (!pageUid) return empty("no page uid");

  const [meetingRows, pageTasks] = await Promise.all([
    readMeetingRows(pageUid),
    readPageTasks(pageUid),
  ]);
  const meetings = selectMeetings(meetingRows);
  if (!meetings.length) return empty("no meetings found");

  const plan = planWindow({
    meetings,
    hostAncestorUids: host?.ancestorUids ?? [],
    forcedMode: args.forcedMode,
    lookbackDays: args.lookbackDays,
    now,
  });
  if (!plan.scan.length) return empty(`no meetings within ${args.lookbackDays} days`);

  const trees = await readTrees(plan.scan.map((m) => m.uid));

  // Walk ((ref)) wrapper chains one hop per round, one read per round.
  const blocks = new Map<string, Block>();
  const lookupBlock = (uid: string) => blocks.get(uid);
  const items = headerItems(findHeaders(trees, ANCHOR_UID)).map((i) => i.block);
  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    const want = pendingWrapperTargets(items, lookupBlock, MAX_REF_HOPS);
    if (!want.length) break;
    const got = await readBlocks(want);
    if (!got.size) break;
    for (const [uid, b] of got) blocks.set(uid, b);
  }

  const view = deriveView({
    pageUid,
    meetings,
    plan,
    trees,
    pageTasks,
    lookupBlock,
    anchorUid: ANCHOR_UID,
    celebrateDays: CELEBRATE_DAYS,
    maxHops: MAX_REF_HOPS,
    now,
  });
  if (!view.primary.length && !view.secondary.length)
    return empty(`nothing to show. ${view.debug}`);

  // Only the visible section's refs. The collapsed section reads its own
  // when it is opened.
  const texts = await readRefTexts(view.primary.map((r) => r.task.string));
  return { kind: "view", view, texts, ms: ms() };
};
