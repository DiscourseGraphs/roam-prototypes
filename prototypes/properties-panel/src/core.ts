/* Pure core — no Roam calls, no DOM. The vitest suite exercises everything
 * here directly; keep it side-effect free.
 *
 * Ported from the roam/js prototype (DiscourseGraphs/dg-properties-panel
 * prototype/extension.js v0.4.2) with logic unchanged.
 */

import type {
  Anomaly,
  ConfigAction,
  Extra,
  InlineToken,
  ParsedProps,
  PickerOption,
  Registry,
  RegistryEntry,
  Slot,
  Tree,
  Value,
  WriteOp,
} from "~/types";

/** Classify a raw attribute value string. */
// The Flow-family templates ship attribute lines whose only "value" is an
// ℹ info link to a help block — `FlowImpact:: [ℹ](((VGGDK1RQI)))`. An
// unfilled slot therefore isn't blank text; the link is deleted when a real
// value is written. Only the literal ℹ label counts — `[details](((uid)))`
// stays a value.
const INFO_LINK_ONLY_RE = /^(\[ℹ\]\(\(\([^()\s]+\)\)\)\s*)+$/;

// Whole-value markdown forms resolve instead of showing raw (Matt 8/18):
// `[label](url)` is a url slot carrying its label (issuesync writes
// `Linear::` this way), `((uid))` and `[label](((uid)))` are block refs —
// the display layer looks up the referenced block's text. The stored raw
// is untouched; "edit as text" still shows and writes the markdown.
const ALIAS_URL_RE = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/;
const ALIAS_REF_RE = /^\[([^\]]*)\]\(\(\(([^()\s]+)\)\)\)$/;
const BLOCK_REF_RE = /^\(\(([^()\s]+)\)\)$/;

export const parseValue = (raw: string | null | undefined): Value => {
  const s = (raw || "").trim();
  if (!s) return { kind: "empty", raw: s };
  if (INFO_LINK_ONLY_RE.test(s)) return { kind: "empty", raw: s, infoLink: true };
  const alias = ALIAS_URL_RE.exec(s);
  if (alias) return { kind: "url", raw: s, url: alias[2], label: alias[1] };
  const aref = ALIAS_REF_RE.exec(s);
  if (aref) return { kind: "blockref", raw: s, uid: aref[2], label: aref[1] };
  const bref = BLOCK_REF_RE.exec(s);
  if (bref) return { kind: "blockref", raw: s, uid: bref[1] };
  // A single [[...]] wrapper (inner brackets allowed: [[[[UC]] - x]]).
  if (s.startsWith("[[") && s.endsWith("]]")) {
    const inner = s.slice(2, -2);
    // Reject "[[a]] and [[b]]" — wrapper must be one balanced ref.
    let depth = 0,
      wraps = true;
    for (let i = 0; i < inner.length - 1; i++) {
      if (inner[i] === "[" && inner[i + 1] === "[") (depth++, i++);
      else if (inner[i] === "]" && inner[i + 1] === "]") {
        depth--;
        i++;
        if (depth < 0) break;
      }
    }
    if (depth < 0) wraps = false;
    if (wraps) return { kind: "page", raw: s, title: inner };
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: "number", raw: s, num: Number(s) };
  if (/^https?:\/\/\S+$/.test(s)) return { kind: "url", raw: s, url: s };
  return { kind: "text", raw: s };
};

/**
 * Display-only cleanup for a RESOLVED block string shown inline in a chip:
 * unwrap [[page refs]] and #tags so one line of another block reads as
 * prose. Never used for writes — the ref itself stays `((uid))`.
 */
export const refText = (s: string | null | undefined): string =>
  (s || "").replace(/\[\[|\]\]/g, "").replace(/(^|\s)#(\S)/g, "$1$2");

/** Canonical written form for a value in a vocabulary of a given kind. */
export const canonicalRaw = (title: string, vocabKind: string | null): string =>
  vocabKind === "page" ? `[[${title}]]` : title;

/**
 * Display-only title cleanup (Matt 8/6): drop the `[[TYP]] - ` node-format
 * prefix, or a single-word capitalized `Namespace/` prefix (Project/,
 * Initiative/, …). The word-boundary rule keeps slashes inside real titles
 * ("…import/publish in Obsidian") intact, and lowercase namespaces
 * (roam/js/…) are never node dropdowns. Selection, filtering, and writes
 * all keep the full title — this only changes what the eye scans.
 */
export const displayTitle = (title: string | null | undefined): string => {
  const t = title || "";
  const fmt = /^\[\[[^\]]+\]\]\s*-\s*/.exec(t);
  if (fmt && fmt[0].length < t.length) return t.slice(fmt[0].length);
  const ns = /^[A-Z][A-Za-z0-9_-]*\//.exec(t);
  if (ns && ns[0].length < t.length) return t.slice(ns[0].length);
  return t;
};

/**
 * Per-attribute display templates, copied verbatim from attribute-select's
 * TEMPLATE_MAP (workbench/src/features/attributeSelect.tsx). DISPLAY-ONLY
 * there and here: the written value is always the raw option text.
 * "Custom Format" runs a single (non-global) replace — also parity.
 */
const TEMPLATES: Record<string, (s: string) => string> = {
  "No styling": (s) => s,
  "Remove Double Brackets": (s) => s.replace(/\[\[(.*?)\]\]/g, "$1"),
  "Convert to Uppercase": (s) => s.toUpperCase(),
  "Capitalize Words": (s) =>
    s
      .split(" ")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
      .join(" "),
};

export const applyTemplate = (
  text: string,
  name: string,
  customPattern?: string | null,
  customReplacement?: string | null,
): string => {
  if (name === "Custom Format") {
    if (!customPattern) return text;
    try {
      return text.replace(new RegExp(customPattern), customReplacement || "");
    } catch (e) {
      return text;
    }
  }
  const fn = TEMPLATES[name];
  return fn ? fn(text) : text;
};

/**
 * Map SmartBlock-resolved option nodes (triggerSmartblock's return value)
 * to picker options. The raw text is what a pick WRITES (attribute-select
 * writes it verbatim); title is the bracket-free form used for selection
 * comparison; label is what the dropdown shows — the declared template
 * when there is one, the panel's clean title default otherwise.
 */
export const optionsFromSmartblockResults = (
  nodes: ({ text?: string } | null)[] | null,
  entry?: Pick<RegistryEntry, "template" | "customPattern" | "customReplacement"> | null,
): PickerOption[] =>
  (nodes || [])
    .map((n) => (n && typeof n.text === "string" ? n.text.trim() : ""))
    .filter(Boolean)
    .map((raw) => {
      const v = parseValue(raw);
      const title = v.kind === "page" ? v.title : raw;
      const t = entry && entry.template;
      const label = displayTitle(
        t && t !== "No styling"
          ? applyTemplate(raw, t, entry!.customPattern, entry!.customReplacement)
          : title,
      );
      return { title, raw, kind: v.kind === "page" ? "page" : "text", label };
    });

const ATTR_RE = /^([^:\n]+):: ?(.*)$/s;
// Single-colon `Key: value` lines are DELIBERATE on some pages (e.g.
// `Linear: [alias](url)` renders as a clean link instead of creating an
// attribute). Rendered as read-only rows, never flagged, never editable.
// The first colon must be followed by whitespace, so URLs don't match.
const STATIC_RE = /^([A-Za-z][^:\n]{0,40}):\s+(\S.*)$/s;
// A {{Label:SmartBlock:Workflow...}} button (e.g. "Project canvas").
const BUTTON_RE = /\{\{([^:}]+):\s*SmartBlock:\s*([^:},]+)([^}]*)\}\}/;

/**
 * Parse the properties block's subtree.
 * Returns {blockUid, slots, extras, anomalies}; extras are read-only rows.
 */
export const parsePropertiesTree = (tree: Tree): ParsedProps => {
  const slots: Slot[] = [];
  const extras: Extra[] = [];
  const anomalies: Anomaly[] = [];
  const seen = new Set<string>();
  for (const child of tree.children || []) {
    const s = child.string || "";
    const m = ATTR_RE.exec(s);
    if (m) {
      const key = m[1].trim();
      if (seen.has(key)) {
        anomalies.push({ type: "duplicate-key", uid: child.uid, key });
        continue;
      }
      seen.add(key);
      slots.push({
        key,
        uid: child.uid,
        valueRaw: (m[2] || "").trim(),
        value: parseValue(m[2]),
        children: (child.children || []).map((c) => ({
          uid: c.uid,
          text: (c.string || "").trim(),
          value: parseValue(c.string),
        })),
      });
      continue;
    }
    const b = BUTTON_RE.exec(s);
    if (b) {
      extras.push({
        type: "button",
        uid: child.uid,
        label: b[1].trim(),
        workflow: b[2].trim(),
      });
      continue;
    }
    const st = STATIC_RE.exec(s);
    if (st) {
      extras.push({
        type: "static",
        uid: child.uid,
        key: st[1].trim(),
        valueRaw: st[2].trim(),
      });
      continue;
    }
    anomalies.push({ type: "unrecognized", uid: child.uid, text: s });
  }
  return { blockUid: tree.uid, slots, extras, anomalies };
};

/**
 * Tokenize inline markup for read-only display: [alias](url), [[Page]]
 * (nested refs tolerated), [alias](((uid))) and ((uid)) block refs,
 * bare URLs, plain text.
 */
export const parseInline = (raw: string | null | undefined): InlineToken[] => {
  const tokens: InlineToken[] = [];
  let s = raw || "";
  const RE =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[([^\]]+)\]\(\(\(([^()\s]+)\)\)\)|\(\(([^()\s]+)\)\)|\[\[((?:[^[\]]+|\[\[[^\]]*\]\])*)\]\]|(https?:\/\/\S+)/;
  while (s.length) {
    const m = RE.exec(s);
    if (!m) {
      tokens.push({ t: "text", s });
      break;
    }
    if (m.index) tokens.push({ t: "text", s: s.slice(0, m.index) });
    if (m[1]) tokens.push({ t: "link", text: m[1], url: m[2] });
    else if (m[3]) tokens.push({ t: "blockref", uid: m[4], label: m[3] });
    else if (m[5]) tokens.push({ t: "blockref", uid: m[5] });
    else if (m[6] !== undefined) tokens.push({ t: "page", title: m[6] });
    else tokens.push({ t: "link", text: m[7], url: m[7] });
    s = s.slice(m.index + m[0].length);
  }
  return tokens;
};

/**
 * Parse the attribute-select registry page tree into
 * {attrName: {type, range, options, dynamic, …}}.
 * Tolerates the drift observed in dg-team: duplicated/empty `range`
 * blocks, empty children, options as page links or plain strings.
 */
export const registryFromTree = (tree: Tree): Registry => {
  const registry: Registry = {};
  const attrsNode = (tree.children || []).find(
    (c) => (c.string || "").trim() === "attributes",
  );
  for (const attr of (attrsNode && attrsNode.children) || []) {
    const name = (attr.string || "").trim();
    if (!name) continue;
    const entry: RegistryEntry = {
      name,
      type: null,
      range: null,
      options: null,
      optionsUid: null, // the options block itself — dynamic entries run it as a SmartBlock
      dynamic: null,
      template: null,
      customPattern: null,
      customReplacement: null,
    };
    for (const part of attr.children || []) {
      const label = (part.string || "").trim();
      const kids = (part.children || [])
        .map((k) => (k.string || "").trim())
        .filter(Boolean);
      if (label === "type" && kids.length) entry.type = kids[0];
      else if (label === "range" && kids.length >= 2) {
        const nums = kids.map(Number);
        if (nums.every((n) => !Number.isNaN(n))) entry.range = [nums[0], nums[1]];
      } else if (label === "template" && kids.length) entry.template = kids[0];
      else if (label === "customPattern" && kids.length) entry.customPattern = kids[0];
      else if (label === "customReplacement" && kids.length)
        entry.customReplacement = kids[0];
      else if (label === "options") {
        entry.optionsUid = part.uid || null;
        for (const o of kids) {
          const dyn = /^<%(\w+)(?::([^,%]+))?/.exec(o);
          if (dyn) {
            entry.dynamic = { kind: dyn[1], query: dyn[2] || null, raw: o };
          } else {
            // (o is already trimmed, so parseValue's raw equals it.)
            (entry.options = entry.options || []).push({
              ...parseValue(o),
              raw: o,
            });
          }
        }
      }
    }
    registry[name] = entry;
  }
  return registry;
};

/** Majority value-kind of a static vocabulary ('page' | 'text' | null). */
export const vocabKind = (
  entry?: Pick<RegistryEntry, "options"> | null,
): "page" | "text" | null => {
  if (!entry || !entry.options || !entry.options.length) return null;
  const pages = entry.options.filter((o) => o.kind === "page").length;
  return pages * 2 >= entry.options.length ? "page" : "text";
};

/** Slot keys in declared order from a node type's template properties block. */
export const slotOrderFromTemplate = (templatePropsTree: Tree): string[] =>
  parsePropertiesTree(templatePropsTree).slots.map((s) => s.key);

/** Option title for comparison purposes (page options compare by title). */
export const optionTitle = (o: { raw: string } & Value): string =>
  o.kind === "page" ? o.title : o.raw;

/**
 * Does a slot's current value conform to its vocabulary?
 * Returns {ok:true} or {ok:false, reason, suggestion}.
 */
export const conformance = (
  slot: Pick<Slot, "value">,
  entry?: RegistryEntry | null,
): { ok: boolean; reason?: string; suggestion?: string | null } => {
  const v = slot.value;
  if (!entry || v.kind === "empty") return { ok: true };
  if (entry.type === "number") {
    if (v.kind !== "number")
      return { ok: false, reason: "not-a-number", suggestion: null };
    if (entry.range && (v.num < entry.range[0] || v.num > entry.range[1]))
      return { ok: false, reason: "out-of-range", suggestion: null };
    return { ok: true };
  }
  if (!entry.options || !entry.options.length) return { ok: true };
  const kind = vocabKind(entry);
  const current = v.kind === "page" ? v.title : v.raw;
  const hit = entry.options.find((o) => optionTitle(o) === current);
  if (hit) {
    // Right value, wrong written form (text where vocab uses page links,
    // or the reverse) — the documented dg-team drift.
    if (v.kind === "text" && kind === "page")
      return { ok: false, reason: "text-vs-page", suggestion: `[[${current}]]` };
    if (v.kind === "page" && kind === "text")
      return { ok: false, reason: "page-vs-text", suggestion: current };
    return { ok: true };
  }
  return { ok: false, reason: "not-in-vocab", suggestion: null };
};

/**
 * Compact display label for a bare-URL slot value (the full URL stays the
 * stored raw and the hover title). Known hosts get a meaningful handle:
 * Linear issues → their key ("PRO-207"), Linear projects → the de-slugged
 * name, GitHub issues/PRs → "repo#123", GitHub repos → "owner/repo".
 * Anything else → the hostname. Unparseable input comes back verbatim.
 */
export const urlDisplay = (url: string): string => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "linear.app") {
      const i = parts.indexOf("issue");
      if (i >= 0 && parts[i + 1]) return parts[i + 1].toUpperCase();
      const p = parts.indexOf("project");
      if (p >= 0 && parts[p + 1])
        return parts[p + 1].replace(/-[0-9a-f]{8,}$/, "").replace(/-/g, " ");
    }
    if (host === "github.com") {
      if (parts.length >= 4 && (parts[2] === "issues" || parts[2] === "pull"))
        return `${parts[1]}#${parts[3]}`;
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
    return host;
  } catch (e) {
    return url;
  }
};

/** Child values of a multi slot that fall outside a static vocabulary. */
export const multiDrift = (
  slot: Pick<Slot, "children">,
  entry?: Pick<RegistryEntry, "options"> | null,
): string[] => {
  if (!entry || !entry.options || !entry.options.length) return [];
  const vocab = entry.options.map(optionTitle);
  return (slot.children || [])
    .map((c) => (c.value.kind === "page" ? c.value.title : c.text))
    .filter((t) => !vocab.includes(t));
};

/**
 * Raw strings for a multi slot's next value set: existing children keep
 * their ORIGINAL text verbatim (never re-canonicalized — an off-vocabulary
 * value must survive unrelated toggles untouched); new picks get the
 * vocabulary's canonical form, unless rawFor supplies the exact raw (used
 * for dynamic options, whose raw text — e.g. a bare ACTIVEUSERS name — is
 * the parity write form).
 */
export const preserveMultiRaws = (
  slot: Pick<Slot, "children">,
  titles: string[],
  kind: string | null,
  rawFor?: (t: string) => string | null,
): string[] => {
  const byTitle = new Map(
    (slot.children || []).map((c) => [
      c.value.kind === "page" ? c.value.title : c.text,
      c.text,
    ]),
  );
  return titles.map((t) =>
    byTitle.has(t) ? byTitle.get(t)! : (rawFor && rawFor(t)) || canonicalRaw(t, kind),
  );
};

/**
 * Insertion order for a ghost slot: after every existing slot the template
 * declares before it. Unknown keys append at the end.
 */
export const insertionOrder = (
  templateOrder: string[],
  existingKeys: string[],
  newKey: string,
): number => {
  const ti = templateOrder.indexOf(newKey);
  if (ti < 0) return existingKeys.length;
  let order = 0;
  for (const k of existingKeys) {
    const ki = templateOrder.indexOf(k);
    if (ki >= 0 && ki < ti) order++;
  }
  return order;
};

type WriteCtx = {
  blockUid: string;
  templateOrder?: string[];
  existingKeys?: string[];
};

/** One canonical single-value write. */
export const planWrite = (
  slot: Pick<Slot, "key" | "uid">,
  newRaw: string,
  ctx: WriteCtx,
): WriteOp[] => {
  const string = newRaw ? `${slot.key}:: ${newRaw}` : `${slot.key}::`;
  if (slot.uid) return [{ op: "update", uid: slot.uid, string }];
  return [
    {
      op: "create",
      parentUid: ctx.blockUid,
      order: insertionOrder(ctx.templateOrder || [], ctx.existingKeys || [], slot.key),
      string,
    },
  ];
};

/** Multi-value diff: parent normalized to `Key::`, one child per value. */
export const planMultiWrite = (
  slot: Pick<Slot, "key" | "uid" | "valueRaw" | "children">,
  newValues: string[],
  ctx: WriteCtx,
): WriteOp[] => {
  const ops: WriteOp[] = [];
  const parentUid = slot.uid;
  if (!slot.uid) {
    ops.push({
      op: "create",
      parentUid: ctx.blockUid,
      order: insertionOrder(ctx.templateOrder || [], ctx.existingKeys || [], slot.key),
      string: `${slot.key}::`,
      thenChildren: newValues.slice(),
    });
    return ops;
  }
  // Inline value (if any) moves into the child set decision: normalize parent.
  if (slot.valueRaw) ops.push({ op: "update", uid: slot.uid, string: `${slot.key}::` });
  const current = slot.children.map((c) => c.text);
  for (const c of slot.children)
    if (!newValues.includes(c.text)) ops.push({ op: "delete", uid: c.uid });
  let order = current.length;
  for (const v of newValues)
    if (!current.includes(v))
      ops.push({ op: "create", parentUid: parentUid!, order: order++, string: v });
  return ops;
};

/** `[[ISS]] - {content}` → anchored regex (any {placeholder} → lazy wildcard). */
export const formatToRegex = (format: string | null | undefined): RegExp => {
  const escaped = (format || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]*\\\}/g, "(.*?)");
  return new RegExp(`^${escaped}$`, "s");
};

export const matchNodeType = <T extends { format?: string | null }>(
  title: string,
  nodeTypes: T[],
): T | null => {
  for (const t of nodeTypes) {
    if (!t.format) continue;
    if (formatToRegex(t.format).test(title)) return t;
  }
  return null;
};

/**
 * Merge the panel's built-in actions with externally registered ones.
 * A registered key matching a built-in REPLACES that stub in place
 * (keeping the row's order); unmatched registered keys append after.
 * The panel stays agnostic about what registrars do — e.g. the
 * Linear-Roam sync extension owns the "linear" slot.
 */
export const actionSlots = (
  configActions: ConfigAction[],
  registeredKeys: string[],
): ({ key: string; registered: true } | { key: string; registered: false; action: ConfigAction })[] => {
  const out = configActions.map((a) =>
    registeredKeys.includes(a.key)
      ? ({ key: a.key, registered: true } as const)
      : ({ key: a.key, registered: false, action: a } as const),
  );
  const appended: { key: string; registered: true }[] = [];
  for (const k of registeredKeys)
    if (!configActions.some((a) => a.key === k)) appended.push({ key: k, registered: true });
  return [...out, ...appended];
};
