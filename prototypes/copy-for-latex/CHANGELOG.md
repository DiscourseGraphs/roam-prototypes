# Changelog

## 0.0.2 - 2026-08-19

- The menu's stylesheet is carried in the bundle instead of shipped as a separate
  `extension.css`. Roam injects that file only when it loads an extension from a URL, so under a
  `roam/js` loader block the menu had no `position: fixed` and rendered as an invisible static
  list at the end of the document.

## 0.0.1 - 2026-08-19

- Ported from the standalone `roam/js` prototype into this repository.
- Graph reads moved to `roamAlphaAPI.data.async.*` with parameterized Datalog inputs.
- Right-click now works on a node's own page heading, not only on inline references.

## 0.0.0 - 2026-08-19

- Created the Copy for LaTeX prototype scaffold.
