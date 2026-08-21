# Changelog

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
