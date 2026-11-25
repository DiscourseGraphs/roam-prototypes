/* String rules: what counts as a task, a header, or a reference, and how a
 * block string is turned into display text. Pure functions, no graph access. */

// Anchored to end-of-string on purpose: "next steps for cybrarian position" is
// prose, not a header. Novel wordings are meant to be caught by the anchors.
const HEADER_RE =
  /^(?:(?:next\s+)?actions?(?:\s+items?)?|(?:proposed\s+)?next\s+steps?)(?:\s*[:：])?(?:\s*[/,-]?\s*(?:by\s+\w+|for\s+next\s+time|this\s+week))?(?:\s*[:：])?$/i;
const UID = "[\\w-]{6,}";
// A block that starts with a ((ref)) may be a wrapper around the real task.
const LEAD_REF_RE = new RegExp(`^\\s*\\(\\((${UID})\\)\\)`);
const REF_RE = new RegExp(`\\(\\((${UID})\\)\\)`, "g");
// An ℹ tooltip, with or without the emoji variation selector, pointing at a
// block ([ℹ](((uid)))) or a page ([ℹ]([[Page]])).
const TOOLTIP_RE = new RegExp(`\\[ℹ\\uFE0F?\\]\\((?:\\(\\(${UID}\\)\\)|\\[\\[[^\\]]*\\]\\])\\)`, "g");
// A block reference shown under a label: [label](((uid))).
const ALIAS_REF_RE = new RegExp(`\\[([^\\]]*)\\]\\(\\(\\((${UID})\\)\\)\\)`, "g");
// Any {{component}}: TODO/DONE markers, embeds, buttons, SmartBlocks, POMOs.
const COMPONENT_RE = /\{\{[^{}]*\}\}/g;
const TAG_RE = /#\[\[[^\]]*\]\]|#[^\s[]+/g;
const EMPHASIS_RE = /\*\*|__|\^\^|~~/g;

/* The checkbox marker, in both spellings Roam accepts: {{[[TODO]]}} and
 * {{TODO}}. Every marker rule below is built from this one. */
const marker = (state: string, flags = "") =>
  new RegExp(`\\{\\{(?:\\[\\[)?(?:${state})(?:\\]\\])?\\}\\}`, flags);
const MARKER_RE = marker("TODO|DONE");
const DONE_RE = marker("DONE");

export const hasMarker = (s: string): boolean => MARKER_RE.test(s);
export const isDone = (s: string): boolean => DONE_RE.test(s);
export const isSticky = (s: string): boolean => s.includes(".sticky");

/* The block a wrapper item stands for: its leading ((ref)), unless the item
 * carries its own marker, in which case it is the task itself. */
export const wrapperRef = (s: string): string | null =>
  hasMarker(s) ? null : (LEAD_REF_RE.exec(s)?.[1] ?? null);

/* The string with its checkbox flipped, keeping the marker's spelling. A
 * string without the matching marker is returned unchanged. */
export const withDone = (s: string, done: boolean): string => {
  const [from, to] = done ? ["TODO", "DONE"] : ["DONE", "TODO"];
  return s.replace(marker(from, "g"), (m) => m.replace(from, to));
};

/* Is this block a "next actions" section header? A block that references an
 * anchor tooltip always is. Otherwise it must match the wording, and must not
 * carry its own TODO/DONE marker: a marked block is a task, not a header. */
export const headerKind = (
  s: string,
  anchorUids: readonly string[],
): "anchor" | "wording" | null => {
  if (anchorUids.some((uid) => s.includes(uid))) return "anchor";
  if (hasMarker(s)) return null;
  const bare = s.replace(TOOLTIP_RE, "").replace(EMPHASIS_RE, "").replace(/^#+\s*/, "").trim();
  return HEADER_RE.test(bare) ? "wording" : null;
};

/* Daily-note pages have the uid MM-DD-YYYY. Returns local midnight, or 0. */
export const dailyNoteTime = (uid: string): number => {
  const p = uid.split("-");
  if (p.length !== 3) return 0;
  const t = new Date(+p[2], +p[0] - 1, +p[1]).getTime();
  return Number.isFinite(t) ? t : 0;
};

/* Everything in a block string that is not text: tooltips, components
 * (markers, embeds, buttons), and the targets of labelled block references.
 * Removed before refs are resolved, so refs inside them are never read. */
const dropNonText = (s: string): string =>
  s
    .replace(TOOLTIP_RE, "")
    .replace(ALIAS_REF_RE, (_m, label: string, uid: string) => (label.trim() ? label : `((${uid}))`))
    .replace(COMPONENT_RE, "");

/* The refs whose text the display of `s` needs. */
export const displayRefUids = (s: string): string[] =>
  [...dropNonText(s).matchAll(REF_RE)].map((m) => m[1]);

/* Block string → one line of display text. Markup is removed rather than
 * rendered: the row is a link, and nested links inside it would fight it.
 * Refs are resolved through chains (a ref to a block that is itself a ref),
 * at most `maxHops` deep so a cycle cannot loop forever. A ref whose target
 * is unknown drops out. */
export const displayText = (
  s: string,
  lookup: (uid: string) => string | undefined,
  maxHops: number,
): string => {
  let out = dropNonText(s);
  for (let i = 0; i < maxHops; i++) {
    const next = out.replace(REF_RE, (_whole, uid: string) => dropNonText(lookup(uid) ?? ""));
    if (next === out) break;
    out = next;
  }
  out = out
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\((?:https?:|mailto:|\[\[)[^)]*\)/g, "$1")
    // Remove every bracket rather than matching pairs: nested node titles
    // like [[[[QUE]] - ...]] leave strays otherwise.
    .replace(/\[\[|\]\]/g, "")
    .replace(EMPHASIS_RE, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return out || "(untitled block)";
};

/* A meeting block as a label: "[[September 22nd, 2026]] #.sticky {{button}}"
 * becomes "September 22nd, 2026". */
export const meetingTitle = (s: string): string =>
  displayText(s.replace(TAG_RE, ""), () => undefined, 1);
