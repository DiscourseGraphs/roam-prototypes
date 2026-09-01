# Changelog

## 0.6.1 - 2026-08-25

- Action-row buttons no longer get crushed when the row runs out of width
  next to the page title: each button keeps its natural single-line size
  (`flex:none`, `white-space:nowrap`) and the row wraps onto more lines
  instead. Before, flex shrink squeezed every button to min-content and
  labels broke mid-word — with the vertically centered icon landing beside
  the middle line, "Convert this Issue…" read as scrambled.

## 0.6.0 - 2026-08-25

- SmartBlock buttons declared in the properties block now render in the
  title-level actions row — after the configured/registered action slots,
  in block order — instead of at the bottom of the property grid (workflow
  verbs at the title, the grid stays nouns; PRO-207). The row stays fresh
  through the existing pull watch, so a self-consuming button (the
  node-convert flow deletes its own block; its cancel path re-creates it)
  disappears and returns with the snapshot.
- A button's declared Blueprint icon (`{{…:SmartBlock:…:Icon=exchange}}`)
  renders before its label, the way SmartBlocks' native button does; the
  hardcoded 🖼 prefix is gone. A button without `Icon=` shows its label
  only — the panel never invents an icon.

## 0.5.2 - 2026-08-19

- The panel now updates when someone ELSE writes the properties block — a
  pull watch on the block reloads the snapshot (debounced) on any change, so
  issuesync's "Send to Linear" writeback fills the `Linear::` chip without
  navigating away. Works for any writer: other extensions, agents, and edits
  made in "view as blocks".
- `window.dgPropsPanel.refresh()` now forces a fresh remount when the panel
  is already mounted, instead of returning early.

## 0.5.1 - 2026-08-19

- Fixed the load failure on the roam/js `import()` path — the same pair of
  bugs copy-for-latex shipped: a default import from CommonJS
  roamjs-components arrives as `{ default: fn }` under esbuild's Node-interop
  `__toESM` and throws when called (the stylesheet is now injected by local
  code), and `runExtension`'s production failure reporter reads
  `extensionAPI.settings` — undefined when loaded from a roam/js block — so
  it masked the real error as "Cannot read properties of undefined (reading
  'settings')". Errors are now caught and reported before that reporter can
  run, and a missing `data.async.q` capability names itself.
- Guards: `tests/interop.spec.ts` bans default imports from
  roamjs-components at the source level, and `tests/bundle.spec.ts` loads
  the built `dist/extension.js` in jsdom with host globals stubbed and runs
  `onload` exactly as the loader block does (verified to fail against the
  buggy build).

## 0.5.0 - 2026-08-19

- Ported the panel from its roam/js prototype
  (`DiscourseGraphs/dg-properties-panel`, extension.js v0.4.2) into this
  repository's installable developer-extension form: ES module with a
  `runExtension` lifecycle, all graph reads through
  `roamAlphaAPI.data.async.*` (the panel renders from a pre-loaded
  snapshot), writes through `data.block.*`, parameterized Datalog
  throughout.
- Behavior carried over intact, including the v0.4.x line: inline link
  chips with compact URL handles, display-only title prefix stripping,
  resolved markdown aliases and block refs, full dark-mode coverage, the
  `registerAction`/`dgpp:ready` extension contract, and SmartBlock-parity
  dynamic options. The 98-assertion offline suite ports pin-for-pin to
  vitest.
