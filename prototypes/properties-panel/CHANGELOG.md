# Changelog

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
