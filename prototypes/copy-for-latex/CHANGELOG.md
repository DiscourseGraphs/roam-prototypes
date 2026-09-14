# Changelog

## 0.0.4 - 2026-08-19

- Fixed the load failure. `import addStyle from "roamjs-components/dom/addStyle"` compiles to a
  call on `{ default: fn }`: roamjs-components is CommonJS, and esbuild's ESM output uses
  Node-interop mode, where a default import of a CommonJS module resolves to the whole module
  object. The stylesheet is injected by six lines of local code instead. A source-level test now
  rejects any default import from roamjs-components.
- The failure reporter no longer depends on the toast succeeding; the console gets the error
  first and unconditionally.

## 0.0.3 - 2026-08-19

- Load failures now report themselves. `runExtension` does not log the error in production, and
  it reads `extensionAPI.settings` while reporting — which is undefined when the module is
  imported from a `roam/js` block, so its reporter threw over the top of the real error. Errors
  are caught before they reach it, and a missing `data.async.q` is named directly.

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
