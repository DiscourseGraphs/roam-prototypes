/* Every knob in one place. What each one does is documented in README.md. */

// Injected by the shared esbuild CLI from package.json; "0.0.0" under vitest.
export const VERSION = process.env.VERSION || "0.0.0";

const LOG = "[meeting-tasks]";
export const logError = (what: string, error: unknown): void =>
  console.error(`${LOG} ${what}`, error);

// The extension's public surface. The roam/render shim (see shim.ts) looks this
// up to hand over its host element, so the name is a contract with every
// graph that has the shim deployed. Never rename it casually.
export const GLOBAL_KEY = "roamMeetingTasks";
// Where the shim parks host elements that rendered before the extension
// finished loading. The extension drains it on load.
export const QUEUE_KEY = "__roamMeetingTasksQueue";

export const STYLE_ID = "roam-meeting-tasks-style";
export const HOST_CLASS = "roam-meeting-tasks-host";
export const FALLBACK_CLASS = "roam-meeting-tasks-fallback";

// The ℹ tooltip blocks that "next actions" headers reference. When a header
// carries one, that beats matching on wording, which drifts across meetings
// and eras. Uids are unique per graph, so listing several graphs' anchors is
// safe. See README "Graph conventions".
export const ANCHOR_UIDS: readonly string[] = [
  "yuAIplpov", // dg-team: next actions
  "6-tIoP1wk", // akamatsulab: 1:1 "Proposed next step"
  "VGiKqwasD", // akamatsulab: group meeting "Proposed next step"
];

// A DONE item stays visible this long so recent wins are seen, then ages out.
export const CELEBRATE_DAYS = 14;

// How far back through meeting history to look. Override per invocation with
// a bare number: {{roam/render: ((uid)) 365}}
export const LOOKBACK_DAYS = 120;

// Every widget on a page asks for the same page-wide data within a few
// milliseconds of each other. Reads started within this window share one
// request. Long enough to cover one page render, short enough that navigating
// away and back shows fresh data.
export const SHARE_MS = 3000;

// How often to look for widgets whose host element Roam has removed, so their
// React roots are unmounted rather than leaked.
export const SWEEP_MS = 10 * 1000;

// Refs can point at refs. Follow at most this many hops, in case of a cycle.
export const MAX_REF_HOPS = 4;

export const DAY_MS = 86400000;
