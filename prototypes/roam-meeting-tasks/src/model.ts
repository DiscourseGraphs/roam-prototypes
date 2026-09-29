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
import type { Mode } from "~/args";
import { DAY_MS } from "~/config";
import { dailyNoteTime, hasMarker, headerKind, isDone, leadRef, stripMarkup } from "~/text";

export type Block = { uid: string; string: string; time: number }; // time = last edit
export type TreeNode = Block & { children: TreeNode[] };
export type PageTask = Block & { parentUids: string[] };
export type MeetingRow = { uid: string; string: string; dailyNoteUid: string; sticky: boolean };
export type Meeting = { uid: string; string: string; time: number }; // time = meeting date
export type Row = { task: Block; meeting: Meeting | null };

/* ── meetings ──────────────────────────────────────────────────────────── */

/* One entry per meeting block, newest first. A block can reference several
 * dates; the meeting's own date is the earliest. The #.sticky tag separates
 * real meeting blocks from prose that happens to mention a date, so when any
 * meeting carries it, only those count. */
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

/* "[[September 22nd, 2026]] #.sticky" → "September 22nd, 2026" */
export const meetingTitle = (s: string): string =>
  stripMarkup(s)
    .replace(/#\S+/g, "")
    .replace(/\[\[|\]\]/g, "")
    .trim();

/* ── mode and window ───────────────────────────────────────────────────── */

export type Plan = {
  mode: Mode;
  hostMeeting: Meeting | null;
  windowStart: number;
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
  forcedMode: Mode | null;
  lookbackDays: number;
  now: number;
}): Plan => {
  const byUid = new Map(input.meetings.map((m) => [m.uid, m]));
  // Nested meeting blocks are rare; when they happen the latest-dated wins,
  // the same rule tasks use below. (The old component took whichever
  // ancestor the query happened to return first.)
  let hostMeeting: Meeting | null = null;
  for (const uid of input.hostAncestorUids) {
    const m = byUid.get(uid);
    if (m && (!hostMeeting || m.time > hostMeeting.time)) hostMeeting = m;
  }
  // Forcing meeting mode outside a meeting used to throw; show page mode.
  const mode: Mode = hostMeeting && input.forcedMode !== "page" ? "meeting" : "page";
  if (mode === "page") hostMeeting = null;
  const anchor = hostMeeting ? hostMeeting.time : input.now;
  const windowStart = anchor - input.lookbackDays * DAY_MS;
  const scan = input.meetings.filter((m) => m.time >= windowStart);
  return {
    mode,
    hostMeeting,
    windowStart,
    scan,
    olderCount: input.meetings.length - scan.length,
    lookbackDays: input.lookbackDays,
  };
};

/* ── headers and the tasks under them ──────────────────────────────────── */

export type Header = { uid: string; meetingUid: string; viaAnchor: boolean; node: TreeNode };

/* Headers sit one or two levels under a meeting block. Bounding the depth is
 * what keeps prose like "next steps for X", which lives deeper under
 * "points of discussion", out of the results. */
export const findHeaders = (trees: readonly TreeNode[], anchorUid: string): Header[] => {
  const seen = new Set<string>();
  const out: Header[] = [];
  const consider = (meetingUid: string, node: TreeNode) => {
    if (seen.has(node.uid)) return;
    const kind = headerKind(node.string, anchorUid);
    if (!kind) return;
    seen.add(node.uid);
    out.push({ uid: node.uid, meetingUid, viaAnchor: kind === "anchor", node });
  };
  for (const t of trees) for (const c of t.children) consider(t.uid, c);
  for (const t of trees) for (const c of t.children) for (const g of c.children) consider(t.uid, g);
  return out;
};

const descendants = (node: TreeNode): TreeNode[] =>
  node.children.flatMap((c) => [c, ...descendants(c)]);

export type HeaderItem = { meetingUid: string; block: Block };

export const headerItems = (headers: readonly Header[]): HeaderItem[] =>
  headers.flatMap((h) =>
    descendants(h.node).map((b) => ({
      meetingUid: h.meetingUid,
      block: { uid: b.uid, string: b.string, time: b.time },
    })),
  );

/* Items are often ((block-ref)) wrappers around the real task, and the real
 * task may live on another page, or be a wrapper itself. Follow the chain to
 * the block that actually holds the marker, so the checkbox writes there. */
export const resolveTask = (
  block: Block,
  lookup: (uid: string) => Block | undefined,
  maxHops: number,
): Block | null => {
  let cur = block;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (hasMarker(cur.string)) return cur;
    const next = leadRef(cur.string);
    const target = next ? lookup(next) : undefined;
    if (!target) return null;
    cur = target;
  }
  return null;
};

/* The wrapper targets the data layer must fetch before resolveTask can run.
 * Call repeatedly with the growing lookup to walk chains one hop at a time. */
export const pendingWrapperTargets = (
  blocks: readonly Block[],
  lookup: (uid: string) => Block | undefined,
  maxHops: number,
): string[] => {
  const wanted = new Set<string>();
  for (const b of blocks) {
    let cur: Block | undefined = b;
    for (let hop = 0; cur && hop <= maxHops; hop++) {
      if (hasMarker(cur.string)) break;
      const next = leadRef(cur.string);
      if (!next) break;
      const target = lookup(next);
      if (!target) {
        wanted.add(next);
        break;
      }
      cur = target;
    }
  }
  return [...wanted];
};

/* ── the view ──────────────────────────────────────────────────────────── */

export type View = {
  mode: Mode;
  primary: Row[];
  secondary: Row[];
  primaryLabel: string;
  secondaryLabel: string;
  olderCount: number;
  lookbackDays: number;
  debug: string;
};

const newestFirst = (a: Row, b: Row): number => {
  const d = (b.meeting?.time ?? 0) - (a.meeting?.time ?? 0);
  return d !== 0 ? d : b.task.time - a.task.time;
};

export const deriveView = (input: {
  pageUid: string;
  meetings: readonly Meeting[];
  plan: Plan;
  trees: readonly TreeNode[];
  pageTasks: readonly PageTask[];
  lookupBlock: (uid: string) => Block | undefined;
  anchorUid: string;
  celebrateDays: number;
  maxHops: number;
  now: number;
}): View => {
  const { meetings, plan } = input;
  const meetingByUid = new Map(meetings.map((m) => [m.uid, m]));
  const headers = findHeaders(input.trees, input.anchorUid);
  const meetingsWithHeaders = new Set(headers.map((h) => h.meetingUid));

  // The same task can be carried forward across meetings: keep the newest.
  const claimed = new Map<string, Row>();
  for (const item of headerItems(headers)) {
    const task = resolveTask(item.block, input.lookupBlock, input.maxHops);
    const meeting = meetingByUid.get(item.meetingUid);
    if (!task || !meeting) continue;
    const prev = claimed.get(task.uid);
    if (prev && (prev.meeting?.time ?? 0) >= meeting.time) continue;
    claimed.set(task.uid, { task, meeting });
  }
  const carried = [...claimed.values()];

  const others: Row[] = input.pageTasks
    .filter((t) => hasMarker(t.string) && !claimed.has(t.uid))
    .map((t) => {
      // A task can sit under nested meeting blocks; the latest-dated wins.
      let meeting: Meeting | null = null;
      for (const p of t.parentUids) {
        const m = meetingByUid.get(p);
        if (m && (!meeting || m.time > meeting.time)) meeting = m;
      }
      return { task: { uid: t.uid, string: t.string, time: t.time }, meeting };
    })
    // A task under a meeting outside the window drops out. Page-level inbox
    // tasks have no meeting and always stay: they are current, not history,
    // and silently hiding open work is worse than a slightly longer list.
    .filter((r) => !r.meeting || r.meeting.time >= plan.windowStart);

  const cutoff = input.now - input.celebrateDays * DAY_MS;
  const visible = (r: Row) => (isDone(r.task.string) ? r.task.time >= cutoff : true);
  const open = (r: Row) => !isDone(r.task.string);

  let primary: Row[];
  let secondary: Row[];
  let primaryLabel: string;
  let secondaryLabel: string;
  const host = plan.hostMeeting;
  if (plan.mode === "meeting" && host) {
    const prev =
      meetings.find((m) => m.time < host.time && meetingsWithHeaders.has(m.uid)) ?? null;
    primary = carried.filter((r) => prev !== null && r.meeting?.uid === prev.uid && visible(r));
    secondary = carried
      .filter((r) => (prev === null || r.meeting?.uid !== prev.uid) && open(r))
      .concat(others.filter(open));
    primaryLabel = prev ? `From last meeting · ${meetingTitle(prev.string)}` : "From last meeting";
    secondaryLabel = "older open items on this page";
  } else {
    primary = carried.filter(visible);
    secondary = others.filter(visible);
    primaryLabel = "Carried over from past next actions";
    // Not "open tasks": in page mode this list also carries recent DONEs.
    secondaryLabel = "Other tasks on this page";
  }
  primary.sort(newestFirst);
  secondary.sort(newestFirst);

  const anchored = headers.filter((h) => h.viaAnchor).length;
  const debug =
    `mode=${plan.mode} lookback=${plan.lookbackDays}d(${plan.scan.length}/${meetings.length} meetings)` +
    ` page=${input.pageUid} meetings=${meetings.length} headers=${headers.length} (anchored ${anchored})` +
    ` carried=${carried.length} others=${others.length}`;

  return {
    mode: plan.mode,
    primary,
    secondary,
    primaryLabel,
    secondaryLabel,
    olderCount: plan.olderCount,
    lookbackDays: plan.lookbackDays,
    debug,
  };
};
