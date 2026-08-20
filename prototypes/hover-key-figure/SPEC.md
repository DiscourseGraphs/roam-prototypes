# Hover Key Figure — Design & Prototype Spec (v1)

**Prototype:** `hover-key-figure` (DiscourseGraphs/roam-prototypes)
**Date:** 2026-08-20 · **Product owner:** Matt Akamatsu
**Context dossier:** `dg-prototypes` → `roam-discourse-hover-metadata/CONTEXT.md` (request inventory, Linear state, code-surface map of `apps/roam`)
**Linear anchors:** executes the outline half of [PRO-50](https://linear.app/discourse-graphs/issue/PRO-50/node-info-hover-preview) / [DES-85](https://linear.app/discourse-graphs/issue/DES-85); replaces the affordance removed by FEE-862; forward-compatible with [ENG-2123](https://linear.app/discourse-graphs/issue/ENG-2123) manual key images.

> Decisions are tagged **[FIRM]** — decided, build to this; **[WORKING]** — current best proposal, flag before deviating; **[OPEN]** — needs product input.

---

## Problem

Presenting discourse nodes in the Roam outliner — journal club, lab meeting, weekly recap — means the audience sees node *titles* but not the figures behind them. The old page-preview feature was removed in July 2026 (FEE-862 / PR #1252), so today the only route to a node's key figure is shift+click → sidebar → scroll, which derails a live presentation. Fourteen months of requests (Emma Koves Jun 2025, Hannah Kimbrough Stowers Aug 2025, Sean Moore Jul+Oct 2025, Matt Jul 2026) ask for the same thing: *see the key figure from where you already are.*

## Product decisions (Matt, 2026-08-20)

1. **[FIRM] Design for presentation.** The trigger is **hover → click**, not hover-to-open: hovering an eligible node reference reveals a small affordance; clicking it shows the figure. A click-opened card is *pinned* — it does not flicker away when the pointer drifts, which is what a presenter needs.
2. **[FIRM] Start with the key figure only.** No relations, no attributes, no metadata rows in v1. (Those are PRO-50's "user-defined properties" future; the CONTEXT dossier catalogs them.)
3. **[FIRM] Click-to-expand in v1.** Clicking the figure in the card expands it, like clicking an image in Roam expands it today — full-viewport lightbox for audience legibility.

## Interaction design

### Rest state — **[FIRM]** zero footprint
Nothing is added to the page at rest. No inline icons, no counts, no layout shift. (DCO 2.0's core lesson: RES-17/RES-28 — always-on chrome gets the feature turned off.)

### Hover — the affordance
- Pointer rests on a **discourse-node page reference** (`span.rm-page-ref` in the main article or sidebar) for `hoverDelayMs` (default **150 ms**) → a small floating chip appears adjacent to the reference: `🖼 Figure`.
- **[WORKING]** The chip is a **singleton** — one DOM element repositioned to whichever eligible ref is hovered — absolutely positioned at the reference's top-right, overlapping nothing (it floats above text in its own stacking context). No per-ref DOM mutation, no layout shift, works with thousands of refs on a page.
- The chip survives the pointer travelling from ref → chip (300 ms grace). Leaving both hides it.
- **Prefetch:** hover also starts async key-figure resolution for that page (cached). By the time a presenter clicks, the image URL is usually known and the browser has begun fetching the image itself.
- If resolution completes with **no figure found**, the chip mutes to a disabled state with title "No figure found on this page" **[WORKING]** — the presenter learns instantly that a node lacks a key figure (which is itself the nudge to set one — the write-side flow, DES-362/ENG-2123/2124).

### Click — the figure card
- Clicking the chip opens the **figure card**: a floating panel anchored to the reference (below it; flips above when viewport space demands).
- Content **[FIRM]**: the key figure image, `object-fit: contain`, card capped at ~40 % of viewport height / ~480 px wide. Plus, **[WORKING]**, a single thin caption bar with the node title (one line, ellipsized) — because the card can visually detach from its reference on a crowded page; delete the caption if it reads as noise in testing.
- The card is **pinned**: it stays open while the pointer moves anywhere. Dismiss via `Esc`, click outside, or clicking the chip again.
- One card at a time (singleton).
- Loading and empty states: spinner ≤ ~1 s; "No figure found on this page" with the page title if resolution came up empty.

### Click the image — the lightbox
- Clicking the image in the card opens a **full-viewport lightbox**: dark backdrop, image at up to 92vw × 92vh, centered — Roam's native image-expand behavior, reproduced for this surface.
- `Esc` or click anywhere closes the lightbox back to the card; `Esc` again closes the card.

### Keyboard summary
`Esc`: lightbox → card → closed. No other bindings in v1.

## Eligibility — what counts as a discourse-node reference

- **[FIRM]** Load the graph's real node-type formats from `discourse-graph/nodes/*` config pages (each page's `Format` child, e.g. `[[RES]] - {content} - {Source}`), compile each to the same regex the plugin uses (`getDiscourseNodeFormatExpression` semantics). This is the proven approach from the sibling `copy-for-latex` prototype — reuse its `loadNodeTypes` / `formatToRegex` (ported, attributed).
- Reference title read from the span's `data-tag` or ancestor `data-link-title`.
- **Fallback** when zero node types load (plugin absent/misconfigured): default regex `^\[\[[A-Z]{2,6}\]\] - ` **[WORKING]**.
- Setting `extraTitleRegex` lets a user add a custom pattern (e.g. `^@` for source pages).

## Key-figure resolution — order of precedence

1. **Manual key image (ENG-2123 forward-compat) [FIRM]:** read the page's Roam props (`:block/props`); if a `discourse-graph` → `keyImage` value exists (matched leniently — the string-write/keyword-read prop trap is real), use it. ENG-2123 is not yet implemented, but reading its future home costs one pull and makes this prototype agree with the decided storage direction from day one.
2. **Automatic — first image, the plugin's own semantics:** port of `findFirstImage` from `apps/roam/src/utils/calcCanvasNodeSizeAndImg.ts` (monorepo), preserving its priority order and the cases naive implementations miss:
   1. image in the block's own text — `!\[…\](https://…)`, after resolving `((block refs))` in the text;
   2. **embeds** — `{{[[embed|embed-path|embed-children]]: ((uid))}}` → recurse into the embedded tree (ENG-485's case; also the AICS import failure mode);
   3. **block references** — scan each referenced block's string;
   4. children, depth-first, with a cycle guard.
- Implementation: one recursive pull of the page tree (`[:block/uid :block/string {:block/children ...}]`), then pure-JS DFS; referenced/embedded uids fetched in one batched parameterized query per level. All reads via `data.async.*`, parameterized `:in` (repo rule).
- **Cache** per page uid, 5-minute TTL. (RES-71 "key images don't refresh" is a known irritation; a short TTL avoids the stale-forever failure without adding refresh UI.)

## Settings (guarded — `extensionAPI` is undefined on the roam/js preview path)

| Setting | Default | Notes |
|---|---|---|
| `hoverDelayMs` | 150 | how long a hover dwells before the chip appears |
| `extraTitleRegex` | "" | additional eligibility pattern |

## Non-goals for v1 (all catalogued in the CONTEXT dossier for later)

- Relations / attributes / creator / dates on the card (PRO-50 property list; DCO integration question).
- The inline-in-outliner "like a query block" variant (Jul 14 mockup 1).
- Canvas, search-result, and Obsidian surfaces (FEE-220, FEE-659, PRO-189 family).
- Writing or setting key images (ENG-2123/2124, DES-362/364 own that).
- Multi-image browsing (RES-97 / DES-367).

## Engineering constraints (repo- and Roam-specific, learned the hard way)

- ESM + esbuild host-globals: **never default-import from `roamjs-components`** (CommonJS interop binds `{default: fn}`); named imports only; local six-line `injectStyle` instead of `addStyle`.
- **Carry all CSS in the bundle** — published `extension.css` is not injected on the roam/js `import()` preview path.
- Wrap the run body in try/catch and `console.error` the real error **before** any toast — `runExtension`'s own reporter destroys load errors when `extensionAPI` is undefined.
- `data.async.*` only; parameterized datalog only.
- Tests are `tests/*.spec.ts` (vitest; root `node --test` must not see them); vitest config needs the `~/` alias added by hand; include a source-text interop guard spec.
- Node ≥ 22 for the toolchain (`~/.nvm/versions/node/v22.23.1/bin`).
- Full unload: remove listeners, singletons, injected style.

## Verification plan

1. `pnpm test` (unit: format→regex, eligibility, resolution priority incl. embeds/refs/props precedence, cache TTL) — plus the dist-harness smoke test pattern if cheap.
2. `pnpm build` && `pnpm prepare:artifacts`.
3. Live: load the PR preview URL in the `plugin-testing-akamatsulab2` graph (*Load Developer Extensions from URL*), hover a `[[RES]]`/`[[EVD]]` ref on a page with figures in embeds, click through chip → card → lightbox; confirm zero layout shift at rest and Esc unwinding.

## Success criteria

A presenter screen-sharing a Roam outline can, without leaving the page or breaking narration: hover a node reference, click one affordance, show the audience the node's key figure at full-screen size, and dismiss it — in under three seconds, with nothing visible on the page before the hover.
