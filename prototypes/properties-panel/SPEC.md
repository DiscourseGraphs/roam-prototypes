# Properties panel — a better view over `#.properties` blocks

*Companion documents referenced below (ASSESSMENT.md, mockup/) live in the private `DiscourseGraphs/dg-properties-panel` repository; this spec is copied verbatim for context.*
*2026-08-04. Companion to [ASSESSMENT.md](ASSESSMENT.md) (P2 there). Target: dg-team
first, portable by construction. Status: spec for review, mockup alongside
(`mockup/index.html`); prototype starts after Matt responds.*

---

## TL;DR

A roam/js component that finds the `#.properties` block on discourse-node pages and
renders it as a compact, Notion-style property panel: filled values as chips, unfilled
slots as ghost affordances, selects and multi-selects driven by the attribute-select
registry, plus a quiet header row of node-level actions (Discourse Context, Publish,
Sync Linear — the latter two mockup-only stubs).

**The blocks remain the only store.** The panel is a lens: every edit is a plain-text
block write in canonical form, so agents, MCP, search, backlinks, query builder,
multiplayer, and hand-editing all keep working. A "view as blocks" toggle flips the
panel back to the raw bullets at any time — the truth is always one click away.

## Why this exists

- The properties block is the team's PM backbone (687 references) but it reads as a
  wall of `Key:: value` bullets, drifts structurally (duplicate blocks, out-of-vocab
  values, page-ref vs plain-text inconsistency), and editing it means remembering
  vocabularies or invoking attribute-select per line.
- The Aug 4 product decision path (assessment §5) keeps Roam's visible blocks as the
  value store precisely because they are naively agent-readable and writable. This
  panel is the human-side compensation: humans get structured editing, agents keep
  markdown.
- It doubles as the seed of attribute-select v2: same registry, better surface, and
  the conformance rules (single/multi, canonical value form) get one enforcement
  point.

## What exists today (verified)

- **Schema, de facto**: `[[roam/js/attribute-select]]` — `attributes → {name} →
  type / range / options / template`. Options are static strings, static page links,
  or dynamic (`<%QUERYBUILDER:…%>`, `<%ACTIVEUSERS:…%>`). `Priority` already declares
  `type: number`, `range: 0–100`.
- **Slot ordering per type**: `discourse-graph/nodes/{Type}` → `Template` →
  properties block children.
- **House component patterns**: `roam-inbox/extension.js` (single-file IIFE roam/js,
  unload-safe re-run, no deps, pull-watch + poll fallback, active-user datalog with
  token/anonymous exclusion — reusable for `ACTIVEUSERS` options) and
  `Roam-render-widget-specs` (§1: `window.React`, `window.Blueprint.Core`,
  `window.roamAlphaAPI` are available globals; §11 has dg-team specifics; §2's
  failure-mode ladder applies to any in-graph component work).
- **Real content for design**: `[[ISS]] - send evd + citation to your authoring
  platform` → Properties: `Linear::` (empty), `Priority:: 12`,
  `Issue Status:: [[🌱 Exploration]]`, `Issue Type:: [[🗳️ Feature Request]]`,
  `Project:: [[Project/Legacy documents to and from discourse nodes]]`,
  `Function:: [[[[UC]] - Manuscript writing]]`, `Flow::` (empty), `Lead::` (empty).

## Approach

**roam/js observer, not `{{roam/render}}`.** The component watches for page renders,
detects a discourse-node page (title format match — later, props identity), locates
the child block tagged `#.properties`, visually collapses that subtree, and mounts the
panel in its place. Rejected alternative: a `{{roam/render}}` call inside the block —
native-feeling but requires editing all ~687 existing pages, and the render-widget
spec's global-name and hydration failure modes make it the more fragile mount for a
whole-subtree takeover. The observer needs zero page edits and can ship as one file.

**Blueprint for chrome.** `window.Blueprint.Core` buttons/popovers so the panel
follows Roam's theme (including dark mode) without shipping CSS beyond layout.

**Everything through one boundary module.** `parseProperties(blockTree) → slots` and
`writeSlot(slot, value) → block ops` are pure functions with tests outside Roam
(`test-panel.js`, mirroring `roam-inbox/test/`). They are the seed of the assessment's
W3 boundary library.

## The panel

Layout (see mockup for visual truth):

```
┌──────────────────────────────────────────────────────────────┐
│ PROPERTIES                    ⌗ view as blocks   ◔ 5/8 filled│
│                                                              │
│ Issue Status   [🌱 Exploration ▾]     Priority  [12 ─────○──]│
│ Issue Type     [🗳️ Feature Request ▾] Project   [Legacy docs…]│
│ Function       [UC - Manuscript writing]                     │
│ Lead           [+ add ▾]   Flow  [+ add ▾]   Linear  [+ add] │
│                                                              │
│ [🧠 Discourse Context] [↑ Publish] [⇄ Sync Linear]  (actions)│
└──────────────────────────────────────────────────────────────┘
```

Behaviors, per state:

1. **Read state.** Two-column grid of label + value chip. Page-ref values render as
   real Roam links (click navigates; shift-click sidebar). Number slots render value
   + inline range bar when `range` is declared. Fill meter (`5/8`) shows progressive
   formalization at a glance.
2. **Ghost slots.** A slot the type's template declares but the page lacks (or has
   empty) renders as a dotted "+ add" chip. Filling it creates the block in template
   order. This is Joel's "the system knows the slot exists and surfaces it" made
   concrete.
3. **Select popover.** Click a vocabulary-backed chip → Blueprint popover listing
   options exactly as attribute-select declares them (icons and all). Writing uses
   the canonical form: page-link options write `[[…]]`, string options write bare
   text. One extra row: "edit as text" escape hatch.
4. **Multi-select.** Slots marked multi-value render token chips; the popover is a
   multi-select; values write as child blocks (the agreed v0 convention), never
   comma-joined.
5. **Drift state.** A value outside the declared vocabulary gets a dotted amber
   underline and a popover offering the nearest vocabulary values or "keep as is."
   Never auto-repaired. (Same affordance later powers the W5 lint's interactive
   mode.)
6. **View as blocks.** Toggle collapses the panel and reveals the native subtree
   (monospace flash highlight on first reveal). State persists per-session only —
   the panel is the default view.

**Header actions row.** Right-aligned quiet buttons: Discourse Context (wired to the
existing overlay when the DG plugin is present), Publish (disabled stub, tooltip
"coming from ENG-2068 line of work"), Sync Linear (disabled stub, tooltip
"experimental"). Mockup explores placement; prototype ships them as stubs behind a
config flag so the panel is useful standalone.

## Schema resolution order

1. `roam/js/attribute-select` → `attributes → {name}`: options, type, range.
2. `discourse-graph/nodes/{Type}` template properties block: which slots this type
   declares, and their order.
3. Neither declares the key → free-text slot (rendered, editable, no vocabulary).

Dynamic options (since v0.2.0, PRO-208): the popover runs the registry's
`options` block as a SmartBlock — `triggerSmartblock({srcUid: optionsUid})`,
the **same call attribute-select makes** — so `<%QUERYBUILDER:name,format%>`
executes the real named query via the DG plugin's command, `<%ACTIVEUSERS%>`
honors its NLP time window / output format / sort, and `<%TAG%>` wraps titles
as page links. The option set is parity-by-construction, cached 60s per
options block. When the SmartBlocks API is absent the popover degrades to
v0 behavior (page-title prefix autocomplete for QUERYBUILDER, graph-member
list for ACTIVEUSERS), labeled "SmartBlocks unavailable" in the footer.

## Writes (the conformance rules, enforced in one place)

- Single-value: `Key:: {canonical value}` on the existing line (update_block).
- Multi-value: `Key::` line + one child block per value.
- Ghost fill: create the `Key::` block at template-order position inside the
  properties block.
- Never touch blocks outside the `#.properties` subtree; never delete a value the
  user typed (drift is flagged, not overwritten).
- All writes are ordinary text edits: native undo applies, multiplayer merges as
  usual, and any agent or human can bypass the panel at will.

## Out of scope, v1

- No props mirroring of values (assessment addendum: identity/provenance only, and
  even that is not this component's job).
- No new storage, no SlotDef schema changes — reads the registry as-is.
- Publish / Sync Linear actual behavior (stubs only).
- Required-slot enforcement at node creation (Phase 3 territory).
- Obsidian anything (frontmatter is already structured there).

## Build & verification plan (after spec sign-off)

1. Pure boundary module + `node test-panel.js` fixtures: parse the real ISS block,
   round-trip writes, multi-value, drift detection, template ordering.
2. Standalone `extension.js` (roam-inbox pattern), developed against the sandbox
   graph via the Chrome injection path; the render-widget spec's §2 failure ladder
   is the debugging reference.
3. In-graph checks on sandbox: edit each state, verify blocks via MCP reads
   (agent-readability is an acceptance criterion, not a hope), undo behavior,
   dark mode, a page with duplicate properties blocks (panel picks the first,
   badges the anomaly), a non-discourse page (panel must not mount).
4. Screenshot set for the team thread; then a supervised run on one live dg-team
   page.

## Decisions (Matt, Aug 4)

1. **Actions row at title level** (placement B), not inside the panel.
2. **Panel is the default view everywhere**, rolled out sandbox-graph-first.
3. **QUERYBUILDER options: prefix autocomplete in v1**; executing the real query is
   the next build item after v1.
4. **Fill meter stays.**
5. Prototype goes to the design/UX team once working.

## Decisions (Matt, Aug 5)

6. **`type: number` beats options.** Registry entries can carry both (Priority
   declares range 0–100 AND three leftover text options from an older
   scheme); the declared type wins and gets the slider + numeric editor.
   Options on a number-typed slot are treated as legacy leftovers and ignored.
7. **Cardinality is a future per-slot setting**, not a heuristic. Which slots
   are multi-select vs single-select becomes part of the slot definition in
   the attribute-select revamp (and SlotDefs after it). Until then the panel
   infers multi from existing child values plus `CONFIG.multiValueSlots`.
8. **Slot/relation overlap is real and tracked, not resolved here.** `Flow::`
   on an Issue is barely different from an "Addresses" relation with range
   (Flow | Hypothesis | Journey). Reference-valued slots are typed relations
   wearing property clothes; the convergence lives on
   `Project/Node slot properties and sync`.

## Decisions (build, Aug 5 — PRO-208)

9. **Parity by shared code path, not reimplementation.** Dynamic options run
   the registry's `options` block through `triggerSmartblock` exactly as
   attribute-select does (verified in `workbench/src/features/attributeSelect.tsx`);
   the panel never parses or re-executes `<%QUERYBUILDER%>` semantics itself.
   Whatever SmartBlocks + the DG plugin return IS the option set.
10. **Display templates are display-only** ("Remove Double Brackets" et al.).
    Verified in the attribute-select source: `transformItem` shapes the menu
    label; the write is always the raw option text. Earlier drafts said
    "respected on write" — that was wrong; the panel mirrors the real
    behavior, including the lazy-regex quirk on nested titles (test-pinned).
11. **Option labels**: when an attribute declares a template, the label is the
    template applied to the raw option text (attribute-select behavior); with
    no template, the panel shows its clean bracket-free title instead of
    attribute-select's literal `[[…]]` raw text. Deliberate small delta.
12. **Live-query membership is not drift.** A selected value missing from
    current query results stays deselectable but gets no ⚠ — only static
    vocabularies flag off-vocab values.
13. **Linear-sync stays a separate extension; the dependency points AT the
    panel, not from it** (Matt, Aug 5 evening). The panel must stay
    Linear-agnostic because it should outgrow dg-team; the team's
    Linear-Roam sync tool is the specialist. So v0.3.0 turns the actions
    row into **action slots**: `window.dgPropsPanel.registerAction({key,
    mount})` lets any extension replace a built-in stub in place ("linear",
    "publish") or append a new action. The sync extension registers its
    real "Send to Linear" / "Sync status" buttons into the "linear" slot
    when the panel is present (listening for the `dgpp:ready` document
    event), and keeps its title-attach behavior when it isn't. The "↗ View
    in Linear" portal (navigation) stays panel-owned; the sync *action* is
    slot-owned. This replaces the earlier v2 phrasing "Linear-sync merges
    into the portal button".

## Milestones (canonical list: the Roam project page's Desired Outcome)

Version numbering follows `Project/Node slot properties and sync` — note the
shipped prototype is **v0** there (earlier drafts of this spec said "v1" for
the same thing).

- **v0 — done**: the MVP panel + gentle conformance (drift flags, never
  auto-fixed).
- **v1 — in progress, two tasks**:
  1. **Built (v0.2.0, PRO-208)** — feature parity with attribute-select:
     the real query-builder queries behind `<%QUERYBUILDER%>` options
     execute via SmartBlocks; `ACTIVEUSERS` honors its time window; display
     templates applied (display-only, matching attribute-select — see
     decision 10).
  2. Schema editing at the point of use: "+ add option" inside the popover,
     behind a confirm, writing the attribute-select vocabulary.
- **v2**: Linear-sync compatibility via action slots (decision 13 — the sync
  extension registers its buttons into the panel; panel-side API shipped in
  v0.3.0, sync-side patch pending); attribute-select v2 (one select
  component, per-type scoping, cardinality as a slot setting); slot-value
  queries (ENG-17).
- **v3**: cross-platform value sync (properties block ↔ frontmatter).

## Design context pulled from Linear + Roam (Aug 4)

This panel lands inside an existing design thread, all John Morabito's:

- [PRO-163](https://linear.app/discourse-graphs/issue/PRO-163/properties-and-key-attributes-in-node-cards)
  (Discovery) — "set attributes/properties to display in node cards **per node
  type**", with [DES-275](https://linear.app/discourse-graphs/issue/DES-275/mock-up-node-properties-display-on-cards)
  (Ready for Review, Figma: "Node cards" `BIfyFsQu3FmdZmRvedU2SN` node 141-2) and
  [DES-350](https://linear.app/discourse-graphs/issue/DES-350/mock-up-settings-menu-to-show-how-user-would-choose-which-properties)
  (settings menu choosing which properties display).
- [DES-82](https://linear.app/discourse-graphs/issue/DES-82/human-readable-discourse-properties-in-frontmatter)
  (Discovery, High) — human-readable frontmatter properties in Obsidian, with the
  key-editing edge case (lock vs warn vs sync-back).
- [DIS-152](https://linear.app/discourse-graphs/issue/DIS-152/ability-to-search-attribute-drop-down)
  — attribute-select dropdowns should be searchable past ~10 options.
- Matt's own note (Apr 28, advanced-search spec review, `((lWZ99ju2R))`): "we'll
  need to standardize the attribute lists more than in roam/js/attribute-select,
  given how important it is for LLMs to know" + "I would LOVE to filter by
  attribute value too."

What this changes in the design:

- **Searchable popovers**: any vocabulary over 10 options gets a filter input
  (Issue Status has 10, Use Case 17). Honors DIS-152 directly.
- **Keys are not editable in the panel** — labels render, values edit. This is
  DES-82's edge case resolved the way John's option 1 resolves it (lock), and it
  matches the store design: renaming a slot is a schema operation, not a page edit.
- **Per-type display config is anticipated, not built**: John's node cards are a
  **tldraw canvas** surface — related family, different surface from this
  page-level panel. The panel shows every declared slot in template order (it is
  the editing surface); canvas cards show a chosen subset (compact display
  surface). What should be shared is not the component but the config and the
  grammar: PRO-163's "per node type" chooser should eventually drive both
  surfaces from one config — the panel's config object is shaped so that
  DES-350's settings menu can plug in.
- **Visual convergence with John's card grammar**: his cards render properties as
  icon-keyed muted rows and numeric properties as live sliders. The panel keeps
  text labels (editing surface needs discoverability) but adopts the muted-value
  weight and renders `type: number` + `range` slots with an inline range bar —
  the same family as the card sliders and Roam's native EVD Centrality slider.

## Remaining open question

- When the design/UX review happens (John), does the panel adopt his icon-per-slot
  key column for well-known slots (Source, Project, Author), or stay text-labeled?
  Deferred to that review — one CSS/config change either way.
