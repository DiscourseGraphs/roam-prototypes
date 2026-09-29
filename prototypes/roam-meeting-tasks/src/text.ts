/* String rules: what counts as a task, a header, or a reference, and how a
 * block string is turned into display text. Pure functions, no graph access. */

// Anchored to end-of-string on purpose: "next steps for cybrarian position" is
// prose, not a header. Novel wordings are meant to be caught by ANCHOR_UID.
const HEADER_RE =
  /^(?:(?:next\s+)?actions?(?:\s+items?)?|next\s+steps?)(?:\s*[:：])?(?:\s*[/,-]?\s*(?:by\s+\w+|for\s+next\s+time|this\s+week))?$/i;
const MARKER_RE = /\{\{\[\[(TODO|DONE)\]\]\}\}|\{\{(TODO|DONE)\}\}/;
const DONE_RE = /\{\{\[\[DONE\]\]\}\}|\{\{DONE\}\}/;
// A block that starts with a ((ref)) may be a wrapper around the real task.
const LEAD_REF_RE = /^\s*\(\(([\w-]{6,})\)\)/;
const REF_RE = /\(\(([\w-]{6,})\)\)/g;

export const hasMarker = (s: string): boolean => MARKER_RE.test(s);
export const isDone = (s: string): boolean => DONE_RE.test(s);
export const leadRef = (s: string): string | null => LEAD_REF_RE.exec(s)?.[1] ?? null;
export const refUids = (s: string): string[] => [...s.matchAll(REF_RE)].map((m) => m[1]);

/* The string with its checkbox flipped. Handles both marker spellings Roam
 * accepts, and leaves a string without the matching marker unchanged. */
export const withDone = (s: string, done: boolean): string =>
  done
    ? s.replace(/\{\{\[\[TODO\]\]\}\}/g, "{{[[DONE]]}}").replace(/\{\{TODO\}\}/g, "{{DONE}}")
    : s.replace(/\{\{\[\[DONE\]\]\}\}/g, "{{[[TODO]]}}").replace(/\{\{DONE\}\}/g, "{{TODO}}");

export const stripMarkup = (s: string): string =>
  s
    .replace(/\[ℹ\]\(\(\([\w-]+\)\)\)/g, "")
    .replace(/\*\*|__|\^\^|~~/g, "")
    .replace(/^#+\s*/, "")
    .trim();

/* Is this block a "next actions" section header? A block that references the
 * anchor tooltip always is. Otherwise it must match the wording, and must not
 * carry its own TODO/DONE marker: a marked block is a task, not a header. */
export const headerKind = (s: string, anchorUid: string): "anchor" | "wording" | null => {
  if (anchorUid && s.includes(anchorUid)) return "anchor";
  if (hasMarker(s)) return null;
  const bare = stripMarkup(s).replace(/[:：]\s*$/, "");
  return HEADER_RE.test(bare) ? "wording" : null;
};

/* Daily-note pages have the uid MM-DD-YYYY. Returns local midnight, or 0. */
export const dailyNoteTime = (uid: string): number => {
  const p = uid.split("-");
  if (p.length !== 3) return 0;
  const t = new Date(+p[2], +p[0] - 1, +p[1]).getTime();
  return Number.isFinite(t) ? t : 0;
};

/* Replace every ((ref)) with its target's text, following refs inside the
 * target too. A ref whose target is unknown drops out, as before. Stops after
 * `maxHops` rounds, so a cycle cannot loop forever. */
export const resolveRefs = (
  s: string,
  lookup: (uid: string) => string | undefined,
  maxHops: number,
): string => {
  let out = s;
  for (let i = 0; i < maxHops; i++) {
    const next = out.replace(REF_RE, (_whole, uid: string) => lookup(uid) ?? "");
    if (next === out) break;
    out = next;
  }
  return out;
};

/* Block string → one line of display text. Markup is removed rather than
 * rendered: the row is a link, and nested links inside it would fight it. */
export const displayText = (
  s: string,
  lookup: (uid: string) => string | undefined,
  maxHops: number,
): string => {
  // Embeds go first: they are not text, and a resolved ref inside one could
  // contain "}}" and cut the non-greedy match short.
  const withoutEmbeds = s.replace(/\{\{\[\[embed\]\]:.*?\}\}/g, "");
  const out = resolveRefs(withoutEmbeds, lookup, maxHops)
    .replace(/\{\{\[\[(TODO|DONE)\]\]\}\}|\{\{(TODO|DONE)\}\}/g, "")
    .replace(/\{\{\[\[embed\]\]:.*?\}\}/g, "")
    .replace(/\{\{\[\[POMO\]\]:\s*\d+\}\}/g, "")
    .replace(/!\[\]\(\S+\)/g, "")
    .replace(/\[([^\]]*)\]\((?:https?:[^)]*|\[\[[^)]*)\)/g, "$1")
    // Remove every bracket rather than matching pairs: nested node titles
    // like [[[[QUE]] - ...]] leave strays otherwise.
    .replace(/\[\[|\]\]/g, "")
    .replace(/\*\*|__|\^\^|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return out || "(untitled block)";
};
