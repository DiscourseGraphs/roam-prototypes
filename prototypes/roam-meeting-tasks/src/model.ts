/* What a widget shows, derived from data already read from the graph.
 *
 * Pure functions only: no graph access, no React. roam.ts reads, this file
 * decides, view.tsx displays. Each step is a port of the roam/render
 * component this prototype replaces, and keeps its behavior unless a comment
 * says otherwise.
 *
 * Vocabulary:
 *   meeting   a block on the page that references a daily-note page and is
 *             tagged #.sticky, e.g. "[[September 22nd, 2026]] #.sticky"
 *   header    a "next actions" block one or two levels under a meeting
 *   carried   a task anywhere under a header
 *   other     every other TODO/DONE on the page
 */
import { CELEBRATE_DAYS, DAY_MS, MAX_REF_HOPS } from "~/config";
import { dailyNoteTime, hasMarker, headerKind, isDone, meetingTitle, wrapperRef } from "~/text";

type Mode = "page" | "meeting";

export type Block = { uid: string; string: string; time: number }; // time = last edit
export type TreeNode = Block & { children: TreeNode[] }; // children in outline order
export type PageTask = Block & { parentUids: string[] };
export type MeetingRow = { uid: string; string: string; dailyNoteUid: string; sticky: boolean };
export type Meeting = { uid: string; string: string; time: number }; // time = meeting date
/* `task` is the block the checkbox reads and writes. `shown` is the text the
 * row displays: the header item as written, which for a ((ref)) wrapper keeps
 * any note next to the ref. `order` is the item's outline position, for rows
 * that come from under a header. */
export type Row = { task: Block; meeting: Meeting | null; shown: string; order?: number };

/* ── meetings ──────────────────────────────────────────────────────────── */

/* The latest-dated meeting among these, or null. One rule for the widget's
 * own meeting, a task's meeting, and "last meeting": nested meeting blocks
 * are rare, and when they happen the latest date wins. */
const latest = (ms: Iterable<Meeting | null | undefined>): Meeting | null => {
  let best: Meeting | null = null;
  for (const m of ms) if (m && (!best || m.time > best.time)) best = m;
  return best;
};

/* One entry per meeting block, newest first. A block can reference several
 * dates; the meeting's own date is the earliest. The #.sticky tag separates
 * real meeting blocks from prose that happens to mention a date, so when any
 * meeting carries it, only those count. (roam.ts relies on this rule to skip
 * the page scan when #.sticky meetings exist.) */
export const selectMeetings = (rows: readonly MeetingRow[]): Meeting[] => {
  const byUid = new Map<string, Meeting & { sticky: boolean }>();
  for (const r of rows) {
    const time = dailyNoteTime(r.dailyNoteUid);
    const prev = byUid.get(r.uid);
    if (!prev) byUid.set(r.uid, { uid: r.uid, string: r.string, time, sticky: r.sticky });
    else if (time && (!prev.time || time < prev.time)) prev.time = time;
  }
  const all = [...byUid.values()];
  const sticky = all.filter((m) => m.sticky);
  return (sticky.length ? sticky : all)
    .filter((m) => m.time > 0)
    .sort((a, b) => b.time - a.time)
    .map(({ uid, string, time }) => ({ uid, string, time }));
};

/* ── mode and window ───────────────────────────────────────────────────── */

export type Plan = {
  mode: Mode;
  /* The meetings whose next actions and tasks count: those inside the
   * lookback window and, in meeting mode, dated before the host meeting. */
  scan: Meeting[];
  olderCount: number;
  lookbackDays: number;
};

/* A widget inside a dated meeting block shows the PREVIOUS meeting's next
 * actions (the "last meeting" template slot); anywhere else on the page it
 * shows everything. The lookback window is anchored on the host meeting in the
 * first case, so "last meeting" still resolves after a long gap. */
export const planWindow = (input: {
  meetings: readonly Meeting[];
  hostAncestorUids: readonly string[];
  forcePage: boolean;
  lookbackDays: number;
  now: number;
}): Plan => {
  const byUid = new Map(input.meetings.map((m) => [m.uid, m]));
  const host = input.forcePage ? null : latest(input.hostAncestorUids.map((u) => byUid.get(u)));
  const windowStart = (host ? host.time : input.now) - input.lookbackDays * DAY_MS;
  // Meeting mode looks only backwards. The old component also read the host
  // meeting and newer ones, so a task carried into this meeting's next
  // actions left "From last meeting", and newer items leaked into "older".
  const scan = input.meetings.filter((m) => m.time >= windowStart && (!host || m.time < host.time));
  return {
    mode: host ? "meeting" : "page",
    scan,
    olderCount: input.meetings.filter((m) => m.time < windowStart).length,
    lookbackDays: input.lookbackDays,
  };
};

/* ── headers and the tasks under them ──────────────────────────────────── */

export type Header = { meetingUid: string; viaAnchor: boolean; node: TreeNode };

/* Headers sit one or two levels under a meeting block. Bounding the depth is
 * what keeps prose like "next steps for X", which lives deeper under
 * "points of discussion", out of the results. */
export const findHeaders = (trees: readonly TreeNode[], anchorUids: readonly string[]): Header[] => {
  const seen = new Set<string>();
  const out: Header[] = [];
  const consider = (meetingUid: string, node: TreeNode) => {
    if (seen.has(node.uid)) return;
    const kind = headerKind(node.string, anchorUids);
    if (!kind) return;
    seen.add(node.uid);
    out.push({ meetingUid, viaAnchor: kind === "anchor", node });
  };
  for (const t of trees) for (const c of t.children) consider(t.uid, c);
  for (const t of trees) for (const c of t.children) for (const g of c.children) consider(t.uid, g);
  return out;
};

const descendants = (node: TreeNode): TreeNode[] =>
  node.children.flatMap((c) => [c, ...descendants(c)]);

/* Every block under every header, in outline order. */
export const headerItems = (headers: readonly Header[]): { meetingUid: string; block: Block }[] =>
  headers.flatMap((h) => descendants(h.node).map((block) => ({ meetingUid: h.meetingUid, block })));

/* Items are often ((block-ref)) wrappers around the real task, and the real
 * task may live on another page, or be a wrapper itself. Follow the chain to
 * the block that actually holds the marker, so the checkbox writes there.
 * load.ts reads the chain with the same wrapperRef rule and hop limit. */
const resolveTask = (block: Block, lookup: (uid: string) => Block | undefined): Block | null => {
  let cur: Block | undefined = block;
  for (let hop = 0; cur && hop <= MAX_REF_HOPS; hop++) {
    if (hasMarker(cur.string)) return cur;
    const next = wrapperRef(cur.string);
    cur = next ? lookup(next) : undefined;
  }
  return null;
};

/* ── the view ──────────────────────────────────────────────────────────── */

export type View = {
  primary: Row[];
  secondary: Row[];
  primaryLabel: string;
  /* Meeting mode: the meeting "From last meeting" refers to, shown as a link. */
  lastMeeting: { uid: string; title: string } | null;
  secondaryLabel: string;
  olderCount: number;
  debug: string;
};

/* Newest meeting first; within a meeting, outline order, then latest edit. */
const byMeetingThenOutline = (a: Row, b: Row): number =>
  (b.meeting?.time ?? 0) - (a.meeting?.time ?? 0) ||
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
  b.task.time - a.task.time;

export const deriveView = (input: {
  pageUid: string;
  meetings: readonly Meeting[];
  plan: Plan;
  headers: readonly Header[];
  pageTasks: readonly PageTask[];
  lookupBlock: (uid: string) => Block | undefined;
  now: number;
}): View => {
  const { meetings, plan, headers } = input;
  const meetingByUid = new Map(meetings.map((m) => [m.uid, m]));
  const inScan = new Set(plan.scan.map((m) => m.uid));

  // The same task can be carried forward across meetings: keep the newest.
  const claimed = new Map<string, Row>();
  headerItems(headers).forEach((item, order) => {
    const task = resolveTask(item.block, input.lookupBlock);
    const meeting = meetingByUid.get(item.meetingUid);
    if (!task || !meeting) return;
    const prev = claimed.get(task.uid);
    if (prev && (prev.meeting?.time ?? 0) >= meeting.time) return;
    claimed.set(task.uid, { task, meeting, shown: item.block.string, order });
  });
  const carried = [...claimed.values()];

  const others: Row[] = input.pageTasks
    .filter((t) => hasMarker(t.string) && !claimed.has(t.uid))
    .map((t) => ({ task: t, meeting: latest(t.parentUids.map((p) => meetingByUid.get(p))), shown: t.string }))
    // A task under a meeting outside the scan drops out. Page-level inbox
    // tasks have no meeting and always stay: they are current, not history,
    // and silently hiding open work is worse than a slightly longer list.
    .filter((r) => !r.meeting || inScan.has(r.meeting.uid));

  const cutoff = input.now - CELEBRATE_DAYS * DAY_MS;
  const visible = (r: Row) => (isDone(r.task.string) ? r.task.time >= cutoff : true);
  const open = (r: Row) => !isDone(r.task.string);

  let view: Pick<View, "primary" | "secondary" | "primaryLabel" | "secondaryLabel">;
  // Meeting mode: the last meeting with anything under its next actions. A
  // meeting whose header was left empty (templates add one to every meeting)
  // is skipped.
  const lastMeeting = plan.mode === "meeting" ? latest(carried.map((r) => r.meeting)) : null;
  if (plan.mode === "meeting") {
    const fromLast = (r: Row) => !!lastMeeting && r.meeting?.uid === lastMeeting.uid;
    view = {
      primary: carried.filter((r) => fromLast(r) && visible(r)),
      secondary: carried.filter((r) => !fromLast(r) && open(r)).concat(others.filter(open)),
      primaryLabel: "From last meeting",
      secondaryLabel: "older open items on this page",
    };
  } else {
    view = {
      primary: carried.filter(visible),
      secondary: others.filter(visible),
      primaryLabel: "Carried over from past next actions",
      // Not "open tasks": in page mode this list also carries recent DONEs.
      secondaryLabel: "Other tasks on this page",
    };
  }
  view.primary.sort(byMeetingThenOutline);
  view.secondary.sort(byMeetingThenOutline);

  const anchored = headers.filter((h) => h.viaAnchor).length;
  return {
    ...view,
    lastMeeting: lastMeeting && { uid: lastMeeting.uid, title: meetingTitle(lastMeeting.string) },
    olderCount: plan.olderCount,
    debug:
      `mode=${plan.mode} lookback=${plan.lookbackDays}d(${plan.scan.length}/${meetings.length} meetings)` +
      ` page=${input.pageUid} meetings=${meetings.length} headers=${headers.length} (anchored ${anchored})` +
      ` carried=${carried.length} others=${others.length}`,
  };
};
