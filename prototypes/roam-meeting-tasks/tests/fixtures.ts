/* A fake graph and a fake roamAlphaAPI over it.
 *
 * The graph mirrors every awkward shape observed on dg-team's sync pages
 * (ported from the roam/render component's offline harness):
 *   - meeting blocks identified by a daily-note ref + #.sticky
 *   - prose that merely mentions a date (must not count as a meeting)
 *   - header wording drift: "next actions" / "Actions" / "Action items/for next time"
 *   - a next-actions header nested one extra level (All Hands "Meeting items")
 *   - prose starting with "next steps" at depth 3 (must not count as a header)
 *   - items that are ((block-ref)) wrappers around the real task
 *   - a wrapper whose target lives on another page
 *   - a marker mid-string ("next: {{[[DONE]]}} ...")
 *   - a DONE item older than CELEBRATE_DAYS (must age out)
 *   - the same task carried across two meetings (must appear once, newest)
 *   - a meeting outside the default 120-day window
 *
 * The fake API answers only the pull patterns and queries the extension
 * uses, and counts calls so tests can assert that reads are shared.
 */
import { vi } from "vitest";
import { DAY_MS } from "~/config";
import { hasMarker, isDone } from "~/text";

export const PAGE = "PAGE1xxxx";
export const OTHER_PAGE = "PAGE2xxxx";

type FakeBlock = {
  uid: string;
  string: string;
  children: string[];
  page: string;
  time: number;
  dates: string[]; // daily-note uids this block references
};

// Real Roam uids are 9 characters; the ref regex requires 6 or more.
export const U = (n: string): string => (n + "xxxxxxxxx").slice(0, 9);

export const dnpUid = (daysAgo: number, now: number): string => {
  const d = new Date(now - daysAgo * DAY_MS);
  const p2 = (x: number) => String(x).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${d.getFullYear()}`;
};

export type FakeGraph = ReturnType<typeof buildGraph>;

export const buildGraph = (now = Date.now()) => {
  const blocks = new Map<string, FakeBlock>();
  const add = (
    raw: string,
    string: string,
    children: string[] = [],
    opts: { page?: string; ageDays?: number; dates?: string[] } = {},
  ) => {
    blocks.set(U(raw), {
      uid: U(raw),
      string,
      children: children.map(U),
      page: opts.page ?? PAGE,
      time: now - (opts.ageDays ?? 0) * DAY_MS,
      dates: opts.dates ?? [],
    });
  };
  const M1 = dnpUid(7, now);
  const M2 = dnpUid(14, now);
  const M3 = dnpUid(21, now);
  const M4 = dnpUid(200, now);
  const PROSE = dnpUid(30, now);

  add("host", "{{roam/render: ((CODE)) debug}}");

  // meeting 1: newest. All Hands shape (header one level deeper)
  add("m1", "[[Meeting one]] #.sticky", ["m1items"], { dates: [M1] });
  add("m1items", "Meeting items [ℹ](((TIP)))", ["m1na", "m1pod"]);
  add("m1na", "**next actions**", ["t1", "t2wrap", "t3wrap"]);
  add("t1", "{{[[TODO]]}} #[[Trang Doan]] send team the next-step items", [], { ageDays: 1 });
  add("t2wrap", `((${U("t2")}))`, [], { ageDays: 1 }); // wrapper → on-page target
  add("t2", "{{[[DONE]]}} #[[Karola Kirsanow]] track OKR 1 items", [], { ageDays: 2 });
  add("t3wrap", `((${U("t3off")}))`, [], { ageDays: 1 }); // wrapper → OFF-page target
  add("t3off", "next: {{[[DONE]]}} Sid: create documentation", [], { page: OTHER_PAGE, ageDays: 3 });
  add("m1pod", "**points of discussion**", ["m1prose"]);
  add("m1prose", "next steps for cybrarian position", ["m1prose2"]); // depth 3: not a header
  add("m1prose2", "{{[[TODO]]}} buried task under discussion, not a next action", [], { ageDays: 4 });

  // meeting 2: Roam Product shape (header at depth 1), drifted wording
  add("m2", " [[Meeting two]] #.sticky", ["m2na", "m2other"], { dates: [M2] });
  add("m2na", "Action items/for next time", ["t4", "t5", "t1again"]);
  add("t4", "{{[[TODO]]}} MG to take a look at backlog count over time", [], { ageDays: 5 });
  add("t5", "{{[[DONE]]}} MG to create ticket for text selection bug", [], { ageDays: 40 }); // aged out
  add("t1again", `((${U("t1")}))`); // same task as meeting 1: dedupe, keep newest
  add("m2other", "Next meeting", ["t6"]);
  add("t6", "{{[[TODO]]}} not under a next-actions header", [], { ageDays: 6 });

  // meeting 3: older, wording "Actions"
  add("m3", "[[Meeting three]] #.sticky", ["m3na"], { dates: [M3] });
  add("m3na", "Actions", ["t7"]);
  add("t7", "{{[[TODO]]}} old open item from three meetings ago", [], { ageDays: 20 });

  // meeting 4: outside the default 120-day window
  add("m4", "[[Ancient meeting]] #.sticky", ["m4na"], { dates: [M4] });
  add("m4na", "Next actions", ["t8"]);
  add("t8", "{{[[TODO]]}} ancient item from outside the window", [], { ageDays: 200 });

  // decoys
  add("prose", "PRs including UX work: aiming for [[a date]]", [], { dates: [PROSE] });
  add("inbox", "{{[[TODO]]}} page-level inbox task, under no meeting", [], { ageDays: 7 });

  return { blocks, add, now };
};

/* ── the fake API ────────────────────────────────────────────────────────── */

export const installFakeRoam = (graph: FakeGraph) => {
  const { blocks } = graph;
  const parentOf = () => {
    const out = new Map<string, string>();
    for (const b of blocks.values()) for (const c of b.children) out.set(c, b.uid);
    return out;
  };
  const ancestors = (uid: string): string[] => {
    const p = parentOf();
    const out: string[] = [];
    for (let cur = p.get(uid); cur; cur = p.get(cur)) out.push(cur);
    return out;
  };
  const refsOf = (b: FakeBlock) => {
    const out: Record<string, unknown>[] = b.dates.map((d) => ({ ":block/uid": d, ":log/id": 1 }));
    if (b.string.includes("#.sticky")) out.push({ ":block/uid": "stickyxxx" });
    return out;
  };
  const markerTitle = (s: string): string | null => (isDone(s) ? "DONE" : hasMarker(s) ? "TODO" : null);
  // Entity ids, handed out on first sight. Pages get them too.
  const eids = new Map<string, number>();
  const eidOf = (uid: string): number => {
    if (!eids.has(uid)) eids.set(uid, eids.size + 1);
    return eids.get(uid)!;
  };
  const uidOfEid = (eid: number) => [...eids].find(([, e]) => e === eid)?.[0];

  const view = (b: FakeBlock, pattern: string, depth?: number): Record<string, unknown> => {
    const out: Record<string, unknown> = { ":block/uid": b.uid };
    if (pattern.includes(":db/id")) out[":db/id"] = eidOf(b.uid);
    if (/:block\/page[\s\]]/.test(pattern)) out[":block/page"] = { ":db/id": eidOf(b.page) };
    if (pattern.includes(":block/string")) out[":block/string"] = b.string;
    if (pattern.includes(":edit/time")) out[":edit/time"] = b.time;
    if (pattern.includes("{:block/page")) out[":block/page"] = { ":block/uid": b.page };
    if (pattern.includes("{:block/parents"))
      out[":block/parents"] = ancestors(b.uid).map((u) => ({ ":block/uid": u }));
    if (pattern.includes("{:block/refs")) out[":block/refs"] = refsOf(b);
    if (pattern.includes(":block/order")) {
      const parent = parentOf().get(b.uid);
      out[":block/order"] = parent ? blocks.get(parent)!.children.indexOf(b.uid) : 0;
    }
    // Reversed on purpose: Roam returns children in no particular order, so
    // the code must sort them by :block/order itself.
    // Recursion: `...` for all levels, or a number of levels.
    const levels = depth ?? /\{:block\/children (\.\.\.|\d+)\}/.exec(pattern)?.[1];
    const left = levels === "..." || levels === undefined ? levels : Number(levels);
    if (left !== undefined && left !== 0 && b.children.length)
      out[":block/children"] = [...b.children]
        .reverse()
        .map((c) => view(blocks.get(c)!, pattern, left === "..." ? undefined : (left as number) - 1));
    return out;
  };

  const reverseRefs = (title: string): FakeBlock[] => {
    const all = [...blocks.values()];
    if (title === ".sticky") return all.filter((b) => b.string.includes("#.sticky"));
    return all.filter((b) => markerTitle(b.string) === title);
  };

  const pull = vi.fn(async (pattern: string, eid: [string, string]) => {
    const [attr, value] = eid;
    if (pattern === "[:db/id]") return { ":db/id": eidOf(value) };
    if (attr === ":node/title") {
      if (!pattern.includes("(:block/_refs :limit nil)"))
        throw new Error(`fake pull: unexpected title pattern ${pattern}`);
      const inner = pattern.slice(pattern.indexOf(")") + 1);
      return { ":block/_refs": reverseRefs(value).map((b) => view(b, inner)) };
    }
    const b = blocks.get(value);
    return b ? view(b, pattern) : null;
  });
  // Takes lookup refs ([":block/uid", uid]) or entity ids.
  const pull_many = vi.fn(async (pattern: string, ids: ([string, string] | number)[]) =>
    ids.map((id) => {
      const b = blocks.get(typeof id === "number" ? (uidOfEid(id) ?? "") : id[1]);
      return b ? view(b, pattern) : null;
    }),
  );
  // Only the fallback meeting query, for pages with no #.sticky meetings.
  const q = vi.fn(async (query: string, pageUid: string) => {
    if (!query.includes(":log/id")) throw new Error(`fake q: unexpected query ${query}`);
    return [...blocks.values()]
      .filter((b) => b.page === pageUid)
      .flatMap((b) => b.dates.map((d) => [b.uid, b.string, d]));
  });
  const update = vi.fn(async ({ block }: { block: { uid: string; string: string } }) => {
    const b = blocks.get(block.uid);
    if (!b) throw new Error(`no block ${block.uid}`);
    b.string = block.string;
  });
  const addWindow = vi.fn(async () => {});
  const open = vi.fn(async () => {});

  const api = {
    graph: { name: "discourse-graphs" },
    data: { async: { pull, pull_many, q }, block: { update } },
    ui: { rightSidebar: { addWindow, open } },
  };
  (window as unknown as { roamAlphaAPI: unknown }).roamAlphaAPI = api;
  return api;
};

export type FakeApi = ReturnType<typeof installFakeRoam>;
