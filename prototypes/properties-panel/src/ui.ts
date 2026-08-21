/* The panel's React components. No JSX — `h` calls keep the port close to
 * the roam/js prototype line-for-line. React/ReactDOM resolve to the copies
 * Roam supplies (see the host-globals mapping in extension-base).
 *
 * All graph reads happen OUTSIDE render: the Panel renders from a Snapshot
 * (see graph.ts) and the Popover's dynamic/fallback options load in effects.
 */

import React from "react";
import {
  actionSlots as coreActionSlots,
  canonicalRaw,
  conformance,
  displayTitle,
  multiDrift,
  optionTitle,
  parseInline,
  planMultiWrite,
  planWrite,
  preserveMultiRaws,
  refText,
  urlDisplay,
  vocabKind,
} from "~/core";
import { CONFIG } from "~/config";
import {
  listGraphMembers,
  loadSnapshot,
  pageUidByTitle,
  resolveDynamicOptions,
  titleAutocomplete,
  type Snapshot,
} from "~/graph";
import { applyOps } from "~/writes";
import { blockDomContainer, refs } from "~/dom";
import type {
  Extra,
  NodeType,
  PickerOption,
  Registry,
  RegistryEntry,
  Slot,
  Value,
} from "~/types";

const api = () => (window as any).roamAlphaAPI;
const h = React.createElement;

// ------------------------------------------------------------ slot meta

type SlotMeta = {
  entry: RegistryEntry | null;
  kind: string | null;
  options: PickerOption[] | null;
  dynamic: string | null;
  range?: [number, number] | null;
  fallback?: "users" | "titles";
  prefix?: string | null;
  note?: string;
};

/** Options for a slot's popover, from the pre-loaded registry. */
export const optionsForSlot = (key: string, registry: Registry): SlotMeta => {
  const entry = registry[key];
  if (!entry) return { entry: null, kind: null, options: null, dynamic: null };
  // `type: number` beats options: registry entries can carry BOTH (Priority
  // has range 0–100 plus leftover text options from an older scheme) — the
  // declared type wins, or the number editor never appears.
  if (entry.type === "number")
    return { entry, kind: "number", options: null, dynamic: null, range: entry.range };
  if (entry.dynamic) {
    // Live options load async in the popover (resolveDynamicOptions);
    // fallback/prefix/note describe the degraded path and the footer.
    const isUsers = entry.dynamic.kind === "ACTIVEUSERS";
    const prefix = isUsers
      ? null
      : (CONFIG.queryPrefixes[entry.dynamic.query || ""] ?? null);
    return {
      entry,
      kind: "page",
      options: null,
      dynamic: "smartblock",
      fallback: isUsers ? "users" : "titles",
      prefix,
      note: isUsers
        ? `active users (${entry.dynamic.query || "3 months"})`
        : `query: ${entry.dynamic.query}`,
    };
  }
  if (entry.options && entry.options.length)
    return {
      entry,
      kind: vocabKind(entry),
      options: entry.options.map((o) => ({ title: optionTitle(o) })),
      dynamic: null,
    };
  return { entry, kind: null, options: null, dynamic: null };
};

// ------------------------------------------------------------- UI pieces

const useOutsideClose = (
  ref: { current: HTMLElement | null },
  onClose: () => void,
) => {
  React.useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Chip clicks handle their own open/close toggling — closing here
        // too made a second click on the open chip re-open the popover.
        const t = e.target as Element;
        if (t.closest && t.closest(".dgpp-chip")) return;
        onClose();
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [ref, onClose]);
};

/** Flip the popover leftward when it would overflow the viewport's right edge. */
const useSmartAlign = (ref: { current: HTMLElement | null }) => {
  const [style, setStyle] = React.useState<Record<string, unknown> | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) setStyle({ left: "auto", right: 0 });
  }, []);
  return style;
};

type PopoverProps = {
  slot: Slot;
  meta: SlotMeta;
  multi: boolean;
  onPick: (title: string, raw: string | null) => void;
  onClose: () => void;
  onText: (text: string) => void;
};

const Popover = ({ slot, meta, multi, onPick, onClose, onText }: PopoverProps) => {
  const ref = React.useRef<HTMLElement | null>(null);
  useOutsideClose(ref, onClose);
  const alignStyle = useSmartAlign(ref);
  const [filter, setFilter] = React.useState("");
  // No registry entry means no vocabulary and no number editor — free text
  // is the only meaningful editor, so open straight into it (this is how
  // unregistered slots like `Linear::` edit inline). Multi slots keep the
  // option list: its rows are how out-of-vocab children get deselected.
  const [textMode, setTextMode] = React.useState(!meta.entry && !multi);
  const [text, setText] = React.useState(slot.valueRaw || "");
  const [num, setNum] = React.useState<number | null>(
    slot.value.kind === "number" ? slot.value.num : null,
  );
  // Dynamic vocabularies: run the real query on open (cached), fall back to
  // prefix autocomplete when the SmartBlocks API isn't there.
  const [dyn, setDyn] = React.useState<{
    state: "loading" | "live" | "fallback";
    options: PickerOption[] | null;
  } | null>(meta.dynamic === "smartblock" ? { state: "loading", options: null } : null);
  React.useEffect(() => {
    if (meta.dynamic !== "smartblock") return;
    let alive = true;
    resolveDynamicOptions(meta.entry)
      .then(
        (options) =>
          alive &&
          setDyn(
            options ? { state: "live", options } : { state: "fallback", options: null },
          ),
      )
      .catch((e) => {
        console.warn("properties-panel: dynamic options failed; falling back", e);
        if (alive) setDyn({ state: "fallback", options: null });
      });
    return () => {
      alive = false;
    };
  }, []);
  // Fallback option sets are graph reads, so they load in an effect too
  // (the roam/js prototype read them synchronously during render).
  const [fallbackOpts, setFallbackOpts] = React.useState<PickerOption[]>([]);
  React.useEffect(() => {
    if (!dyn || dyn.state !== "fallback") return;
    let alive = true;
    (meta.fallback === "users"
      ? listGraphMembers()
      : titleAutocomplete(meta.prefix || null, filter)
    ).then((titles) => alive && setFallbackOpts(titles.map((t) => ({ title: t }))));
    return () => {
      alive = false;
    };
  }, [dyn && dyn.state, filter]);

  const needle = filter.toLowerCase();
  let options: PickerOption[] = meta.options || [];
  let note = meta.note || "";
  let loading = false;
  if (meta.dynamic === "smartblock") {
    if (dyn && dyn.state === "live") {
      options = filter
        ? dyn.options!.filter(
            (o) =>
              o.title.toLowerCase().includes(needle) ||
              (o.label || "").toLowerCase().includes(needle),
          )
        : dyn.options!;
    } else if (dyn && dyn.state === "fallback") {
      options =
        meta.fallback === "users"
          ? fallbackOpts.filter((o) => !filter || o.title.toLowerCase().includes(needle))
          : fallbackOpts;
      note =
        (meta.fallback === "users"
          ? "graph members"
          : meta.prefix
            ? `pages under ${meta.prefix}`
            : "all pages") + " · SmartBlocks unavailable";
    } else {
      options = [];
      loading = true;
      note = "running query…";
    }
  } else if (filter) {
    options = options.filter((o) => o.title.toLowerCase().includes(needle));
  }
  const showFilter =
    meta.dynamic === "smartblock" ||
    (meta.options || []).length > CONFIG.searchThreshold;

  const selected = multi
    ? slot.children.map((c) => (c.value.kind === "page" ? c.value.title : c.text))
    : [slot.value.kind === "page" ? slot.value.title : slot.valueRaw];

  if (textMode)
    return h(
      "span",
      { className: "dgpp-pop", ref, style: alignStyle },
      h("input", {
        autoFocus: true,
        value: text,
        placeholder: `${slot.key}:: …`,
        onChange: (e: any) => setText(e.target.value),
        onKeyDown: (e: any) => {
          if (e.key === "Enter") onText(text);
          if (e.key === "Escape") onClose();
        },
      }),
      h(
        "div",
        { className: "dgpp-pfoot" },
        slot.value.kind === "url" &&
          h(
            React.Fragment,
            null,
            h(
              "span",
              {
                className: "esc",
                onClick: () => window.open((slot.value as any).url, "_blank"),
              },
              "open ↗",
            ),
            " · ",
          ),
        slot.value.kind === "blockref" &&
          h(
            React.Fragment,
            null,
            h(
              "span",
              {
                className: "esc",
                onClick: () =>
                  api().ui.rightSidebar.addWindow({
                    window: { type: "block", "block-uid": (slot.value as any).uid },
                  }),
              },
              "open block →",
            ),
            " · ",
          ),
        "writes the text verbatim · Enter to save",
      ),
    );

  if (meta.kind === "number") {
    const lo = meta.range ? meta.range[0] : 0;
    const hi = meta.range ? meta.range[1] : 100;
    const save = () => onText(num == null ? "" : String(num));
    return h(
      "span",
      { className: "dgpp-pop", ref, style: alignStyle },
      h(
        "div",
        {
          style: {
            padding: "8px 10px 4px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          },
        },
        meta.range &&
          h("input", {
            type: "range",
            min: lo,
            max: hi,
            value: num == null ? lo : num,
            style: { flex: 1 },
            onChange: (e: any) => setNum(Number(e.target.value)),
          }),
        h("input", {
          type: "number",
          className: "dgpp-numin",
          autoFocus: !meta.range,
          value: num == null ? "" : num,
          min: meta.range ? lo : undefined,
          max: meta.range ? hi : undefined,
          style: { width: "72px", padding: "2px 6px" },
          onChange: (e: any) =>
            setNum(e.target.value === "" ? null : Number(e.target.value)),
          onKeyDown: (e: any) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onClose();
          },
        }),
      ),
      h(
        "div",
        { className: "dgpp-pfoot" },
        meta.range ? `${lo}–${hi} · ` : "",
        h("span", { className: "esc", onClick: save }, "save"),
        " · ",
        h("span", { className: "esc", onClick: () => setTextMode(true) }, "edit as text"),
      ),
    );
  }

  return h(
    "span",
    { className: "dgpp-pop", ref, style: alignStyle },
    showFilter &&
      h("input", {
        autoFocus: true,
        value: filter,
        placeholder: "filter…",
        onChange: (e: any) => setFilter(e.target.value),
        onKeyDown: (e: any) => e.key === "Escape" && onClose(),
      }),
    h(
      "div",
      { className: "dgpp-opts" },
      // Selected values missing from the option set render as their own
      // rows (⚠ when a static vocabulary exists) — otherwise an
      // out-of-vocabulary child value could never be deselected here.
      (() => {
        const fullTitles = (meta.options || options).map((o) => o.title);
        const staticVocab = !meta.dynamic && !!(meta.options && meta.options.length);
        const extraSel = multi
          ? selected.filter((t) => t && !fullTitles.includes(t))
          : [];
        // Only static vocabularies mark extras with ⚠ — a value missing
        // from a LIVE query result isn't drift (queries are time-varying),
        // it just needs to stay deselectable.
        const row = (title: string, off: boolean, label?: string, raw?: string) =>
          h(
            "div",
            {
              key: (off ? "x-" : "o-") + title,
              className: "dgpp-opt" + (selected.includes(title) ? " sel" : ""),
              onClick: () => onPick(title, raw || null),
            },
            multi &&
              h(
                "span",
                { className: "dgpp-tick" },
                selected.includes(title) ? "✓" : "",
              ),
            h(
              "span",
              { className: "dgpp-optlabel" + (off && staticVocab ? " off" : "") },
              off && staticVocab
                ? "⚠ " + displayTitle(title)
                : label || displayTitle(title),
            ),
          );
        return [
          ...extraSel.map((t) => row(t, true)),
          ...options.map((o) => row(o.title, false, o.label, o.raw)),
          !options.length && !extraSel.length
            ? h(
                "div",
                { key: "none", className: "dgpp-opt" },
                loading ? "running query…" : "no matches",
              )
            : null,
        ];
      })(),
    ),
    h(
      "div",
      { className: "dgpp-pfoot" },
      note ? `${note} · ` : "",
      !multi &&
        slot.value.kind === "page" &&
        h(
          React.Fragment,
          null,
          h(
            "span",
            {
              className: "esc",
              onClick: () => {
                onClose();
                api().ui.mainWindow.openPage({
                  page: { title: (slot.value as any).title },
                });
              },
            },
            `open ${displayTitle((slot.value as any).title)}`,
          ),
          " · ",
        ),
      h("span", { className: "esc", onClick: () => setTextMode(true) }, "edit as text"),
    ),
  );
};

const DriftPopover = ({
  verdict,
  onFix,
  onKeep,
  onClose,
}: {
  verdict: { reason?: string; suggestion?: string | null };
  onFix: () => void;
  onKeep: () => void;
  onClose: () => void;
}) => {
  const ref = React.useRef<HTMLElement | null>(null);
  useOutsideClose(ref, onClose);
  const alignStyle = useSmartAlign(ref);
  return h(
    "span",
    { className: "dgpp-pop", ref, style: alignStyle },
    verdict.suggestion &&
      h(
        "div",
        { className: "dgpp-opt sel", onClick: onFix },
        `→ set to ${verdict.suggestion}`,
      ),
    h("div", { className: "dgpp-opt", onClick: onKeep }, "keep as is"),
    h(
      "div",
      { className: "dgpp-pfoot" },
      verdict.reason === "text-vs-page"
        ? "plain text where the vocabulary uses page links"
        : verdict.reason === "page-vs-text"
          ? "page link where the vocabulary uses plain text"
          : verdict.reason === "out-of-range"
            ? "value is outside the declared range"
            : verdict.reason === "not-a-number"
              ? "this slot expects a number"
              : "value is outside the declared vocabulary",
    ),
  );
};

const Chip = ({
  slot,
  entry,
  refTexts,
  onOpen,
}: {
  slot: Slot;
  entry: RegistryEntry | undefined;
  refTexts: Record<string, string>;
  onOpen: () => void;
}) => {
  const v = slot.value as Value & { title?: string; url?: string; label?: string; uid?: string };
  const multi = slot.children.length > 0;
  const verdict = conformance(slot, entry);
  const bad = multiDrift(slot, entry);
  const hasDrift = !verdict.ok || bad.length > 0;
  const cls =
    "dgpp-chip" +
    (hasDrift ? " drift" : "") +
    (v.kind === "empty" && !multi ? " ghost" : "");
  let body: unknown;
  if (multi)
    body = slot.children.map((c) => {
      const cv = c.value as Value & { title?: string; url?: string; label?: string; uid?: string };
      const label =
        cv.kind === "page"
          ? displayTitle(cv.title)
          : cv.kind === "url"
            ? cv.label || urlDisplay(cv.url!)
            : cv.kind === "blockref"
              ? cv.label && cv.label !== "ℹ"
                ? cv.label
                : refText(refTexts[cv.uid!] || c.text)
              : displayTitle(c.text);
      const hover =
        cv.kind === "page"
          ? cv.title
          : cv.kind === "url"
            ? cv.url
            : cv.kind === "blockref"
              ? refTexts[cv.uid!] || c.text
              : undefined;
      return h("span", { key: c.uid, className: "dgpp-tok", title: hover }, label);
    });
  else if (v.kind === "empty") body = `+ add ${slot.key.toLowerCase()}`;
  else if (v.kind === "page")
    // Rendered as a ref-colored span, NOT a live link: clicking the chip
    // opens the dropdown (Matt 8/4). Navigation lives in the popover's
    // "open page" action, or shift-click on the chip → right sidebar.
    // Full title on hover; the visible text drops format/namespace prefixes.
    body = h("span", { className: "val ref", title: v.title }, displayTitle(v.title));
  else if (v.kind === "url")
    // The link text navigates (a portal's dominant intent); the caret and
    // chip edge still open the editor, so the value stays inline-editable
    // like any other attribute (PRO-207 feedback). A markdown alias shows
    // its own label; a bare URL gets the compact urlDisplay handle.
    body = h(
      "span",
      {
        className: "val ref link",
        title: v.label ? `${v.label}\n${v.url}` : v.url,
        onClick: (e: MouseEvent) => {
          e.stopPropagation();
          window.open(v.url, "_blank");
        },
      },
      "↗ " + (v.label || urlDisplay(v.url!)),
    );
  else if (v.kind === "blockref") {
    // Show the referenced block's text (alias label wins when the author
    // wrote one); a dangling uid falls back to the raw ref.
    const resolved = refTexts[v.uid!] || null;
    body = h(
      "span",
      { className: "val ref", title: resolved || v.raw },
      v.label && v.label !== "ℹ" ? v.label : resolved ? refText(resolved) : v.raw,
    );
  } else if (v.kind === "number" && entry && entry.type === "number" && entry.range) {
    const span = entry.range[1] - entry.range[0] || 1;
    const frac = Math.max(0, Math.min(1, (v.num - entry.range[0]) / span));
    body = h(
      "span",
      { className: "val num" },
      v.raw,
      h(
        "span",
        { className: "dgpp-rangebar" },
        h("span", {
          className: "dgpp-rangefill",
          style: { width: `${Math.round(frac * 100)}%` },
        }),
      ),
    );
  } else body = h("span", { className: "val" }, v.raw);
  return h(
    "span",
    {
      className: cls,
      onClick: async (e: MouseEvent) => {
        if (e.shiftKey && (v.kind === "page" || v.kind === "blockref")) {
          const blockUid =
            v.kind === "page" ? await pageUidByTitle(v.title!) : v.uid;
          if (blockUid)
            api().ui.rightSidebar.addWindow({
              window: {
                type: v.kind === "page" ? "outline" : "block",
                "block-uid": blockUid,
              },
            });
          return;
        }
        onOpen();
      },
    },
    body,
    hasDrift && h("span", { className: "warn" }, "⚠"),
    h("span", { className: "caret" }, "▾"),
  );
};

/** Read-only inline rendering for static rows ([alias](url), [[Page]],
 *  ((block refs)) — resolved to their text, opening in the sidebar — URLs). */
const Inline = ({ raw, refTexts }: { raw: string; refTexts: Record<string, string> }) =>
  h(
    React.Fragment,
    null,
    parseInline(raw).map((tok, i) => {
      if (tok.t === "link")
        return h(
          "a",
          { key: i, onClick: () => window.open(tok.url, "_blank") },
          tok.text,
        );
      if (tok.t === "page")
        return h(
          "a",
          {
            key: i,
            onClick: () => api().ui.mainWindow.openPage({ page: { title: tok.title } }),
          },
          tok.title,
        );
      if (tok.t === "blockref") {
        const resolved = refTexts[tok.uid] || null;
        return h(
          "a",
          {
            key: i,
            title: resolved || tok.uid,
            onClick: () =>
              api().ui.rightSidebar.addWindow({
                window: { type: "block", "block-uid": tok.uid },
              }),
          },
          tok.label || (resolved ? refText(resolved) : `((${tok.uid}))`),
        );
      }
      return h("span", { key: i }, tok.s);
    }),
  );

/**
 * Run a SmartBlock button by clicking its NATIVE rendering inside the
 * hidden subtree — identical behavior to a real click, no SmartBlock API
 * reimplementation. Falls back to the roamjs trigger API if the native
 * button isn't found.
 */
const runButton = (extra: Extra & { type: "button" }) => {
  if (refs.hiddenBlockEl) {
    const btns = Array.from(refs.hiddenBlockEl.querySelectorAll("button"));
    const hit = btns.find((b) => (b.textContent || "").includes(extra.label));
    if (hit) return hit.click();
  }
  const sb = (window as any).roamjs?.extension?.smartblocks;
  if (sb && typeof sb.triggerSmartblock === "function")
    return sb.triggerSmartblock({ srcName: extra.workflow, targetUid: extra.uid });
  console.warn("properties-panel: could not run button", extra.label);
};

// ----------------------------------------------------------------- Panel

const Panel = ({
  snap,
  registry,
  reload,
}: {
  snap: Snapshot;
  registry: Registry;
  reload: () => Promise<void>;
}) => {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [showRaw, setShowRaw] = React.useState(false);

  const { slots, extras, anomalies } = snap.parsed;
  const buttons = extras.filter((e) => e.type === "button") as (Extra & {
    type: "button";
  })[];
  // Single-colon statics (`Linear: [alias](url)`) render as read-only rows
  // with live inline links — same grid as everything else (PRO-207: no
  // standalone portal buttons; the row IS the portal).
  const statics = extras.filter((e) => e.type === "static") as (Extra & {
    type: "static";
  })[];
  const templateOrder = snap.templateOrder;
  const existingKeys = slots.map((s) => s.key);
  const ghosts: Slot[] = templateOrder
    .filter((k) => !existingKeys.includes(k))
    .map((k) => ({
      key: k,
      uid: null,
      valueRaw: "",
      value: { kind: "empty", raw: "" },
      children: [],
    }));
  const all = [...slots, ...ghosts];
  const filled = all.filter(
    (s) => s.value.kind !== "empty" || s.children.length,
  ).length;
  const gridSlots = all;

  const ctx = { blockUid: snap.blockUid, templateOrder, existingKeys };

  const commit = async (ops: Parameters<typeof applyOps>[0]) => {
    await applyOps(ops);
    setOpenKey(null);
    await reload();
  };

  const nativeEl = blockDomContainer(snap.blockUid);
  if (nativeEl) nativeEl.style.display = showRaw ? "" : "none";

  if (showRaw)
    return h(
      "div",
      { className: "dgpp" },
      h(
        "div",
        { className: "dgpp-head" },
        h("span", { className: "dgpp-label" }, "Properties — raw blocks"),
        h("span", { className: "dgpp-spacer" }),
        h(
          "span",
          { className: "dgpp-meta link", onClick: () => setShowRaw(false) },
          "⌗ back to panel",
        ),
      ),
      h(
        "div",
        { className: "dgpp-raw-note" },
        "the store, verbatim — what agents, search, and collaborators without this extension see",
      ),
    );

  return h(
    "div",
    { className: "dgpp" },
    h(
      "div",
      { className: "dgpp-head" },
      h("span", { className: "dgpp-label" }, "Properties"),
      h("span", { className: "dgpp-spacer" }),
      CONFIG.fillMeter &&
        h("span", { className: "dgpp-meta" }, `${filled} of ${all.length} filled`),
      h(
        "span",
        { className: "dgpp-meta link", onClick: () => setShowRaw(true) },
        "⌗ view as blocks",
      ),
    ),
    h(
      "div",
      { className: "dgpp-rows" },
      gridSlots.flatMap((slot) => {
        const entry = registry[slot.key];
        const meta = optionsForSlot(slot.key, registry);
        const multi =
          slot.children.length > 0 || CONFIG.multiValueSlots.includes(slot.key);
        const verdict = conformance(slot, entry);
        const open = openKey === slot.key;
        return [
          h("div", { key: slot.key + "-k", className: "dgpp-k" }, slot.key),
          h(
            "div",
            { key: slot.key + "-v", style: { position: "relative", minWidth: 0 } },
            h(Chip, {
              slot,
              entry,
              refTexts: snap.refTexts,
              onOpen: () => setOpenKey(open ? null : slot.key),
            }),
            open &&
              (!verdict.ok
                ? h(DriftPopover, {
                    verdict,
                    onFix: () => commit(planWrite(slot, verdict.suggestion!, ctx)),
                    onKeep: () => setOpenKey(null),
                    onClose: () => setOpenKey(null),
                  })
                : h(Popover, {
                    slot,
                    meta,
                    multi,
                    onClose: () => setOpenKey(null),
                    onText: (text: string) => commit(planWrite(slot, text, ctx)),
                    // raw (when present) is the dynamic option's exact text —
                    // written verbatim, same as attribute-select.
                    onPick: (title: string, raw: string | null) => {
                      const kind = meta.kind || "text";
                      if (multi) {
                        const cur = slot.children.map((c) =>
                          c.value.kind === "page" ? c.value.title : c.text,
                        );
                        const next = cur.includes(title)
                          ? cur.filter((t) => t !== title)
                          : [...cur, title];
                        commit(
                          planMultiWrite(
                            slot,
                            preserveMultiRaws(slot, next, kind, (t) =>
                              t === title ? raw : null,
                            ),
                            ctx,
                          ),
                        );
                      } else {
                        commit(planWrite(slot, raw || canonicalRaw(title, kind), ctx));
                      }
                    },
                  })),
          ),
        ];
      }),
    ),
    statics.length > 0 &&
      h(
        "div",
        {
          className: "dgpp-rows",
          style: { marginTop: "6px", gridTemplateColumns: "auto 1fr" },
        },
        statics.flatMap((e) => [
          h("div", { key: e.uid + "-k", className: "dgpp-k" }, e.key),
          h(
            "div",
            { key: e.uid + "-v", className: "dgpp-static" },
            h(Inline, { raw: e.valueRaw, refTexts: snap.refTexts }),
          ),
        ]),
      ),
    buttons.length > 0 &&
      h(
        "div",
        { className: "dgpp-btnrow" },
        buttons.map((b) =>
          h(
            "span",
            { key: b.uid, className: "dgpp-abtn", onClick: () => runButton(b) },
            "🖼 " + b.label,
          ),
        ),
      ),
    (anomalies.length > 0 || snap.duplicates > 0) &&
      h(
        "div",
        { className: "dgpp-anom" },
        [
          snap.duplicates > 0 &&
            `${snap.duplicates + 1} #.properties blocks on this page (using the first)`,
          ...anomalies.map((a) =>
            a.type === "duplicate-key"
              ? `duplicate key "${a.key}"`
              : `unrecognized line inside properties`,
          ),
        ]
          .filter(Boolean)
          .join(" · "),
      ),
  );
};

/** Loads the Snapshot and re-loads it after every write. */
export const PanelRoot = ({
  pageUid,
  type,
  registry,
}: {
  pageUid: string;
  type: NodeType;
  registry: Registry;
}) => {
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    loadSnapshot(pageUid, type).then((s) => alive.current && setSnap(s));
    return () => {
      alive.current = false;
    };
  }, [pageUid, type]);
  const reload = React.useCallback(async () => {
    const s = await loadSnapshot(pageUid, type);
    if (alive.current) setSnap(s);
  }, [pageUid, type]);
  if (!snap) return null;
  return h(Panel, { snap, registry, reload });
};

// ------------------------------------------------------- title-level row

export type ActionSpec = {
  key: string;
  mount: (host: HTMLElement, ctx: unknown) => (() => void) | void;
};

export const actionRegistry = new Map<string, ActionSpec>();

const SlotHost = ({ action, ctx }: { action: ActionSpec; ctx: unknown }) => {
  const ref = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: (() => void) | null = null;
    try {
      cleanup = action.mount(el, ctx) || null;
    } catch (e) {
      console.warn("properties-panel: action mount failed:", action.key, e);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch (e) {
        /* registrar's problem */
      }
      el.innerHTML = "";
    };
  }, [action, ctx && (ctx as any).pageUid]);
  return h("span", { ref, className: "dgpp-slot", "data-slot": action.key });
};

const StubAction = ({ a }: { a: { key: string; label: string; enabled: boolean; badge?: string } }) =>
  h(
    "span",
    {
      className: "dgpp-abtn" + (a.enabled ? "" : " stub"),
      title: a.enabled
        ? a.key === "context"
          ? "jump to the Discourse Context widget (persistent window planned)"
          : ""
        : a.key === "publish"
          ? "coming from the schema-sync line of work"
          : "experimental — not wired yet",
      onClick: () => {
        if (!a.enabled) return;
        if (a.key === "context") {
          // Point at the existing Discourse Context widget and flash it.
          const el =
            document.querySelector(".roamjs-discourse-context") ||
            document.querySelector(".rm-reference-main");
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            (el as HTMLElement).style.transition = "box-shadow .3s";
            (el as HTMLElement).style.boxShadow = "0 0 0 2px #106BA3";
            setTimeout(() => {
              (el as HTMLElement).style.boxShadow = "";
            }, 1200);
          }
        }
      },
    },
    a.label,
    a.badge && h("span", { className: "xbadge" }, a.badge),
  );

export const TitleActions = ({ ctx }: { ctx: unknown }) =>
  h(
    "div",
    {
      id: "dg-props-actions-inner",
      style: { display: "flex", gap: "8px", alignItems: "center" },
    },
    coreActionSlots(CONFIG.actions, Array.from(actionRegistry.keys())).map((slot) =>
      slot.registered
        ? h(SlotHost, {
            key: slot.key + ":" + ((ctx && (ctx as any).pageUid) || ""),
            action: actionRegistry.get(slot.key)!,
            ctx,
          })
        : h(StubAction, { key: slot.key, a: (slot as any).action }),
    ),
  );
