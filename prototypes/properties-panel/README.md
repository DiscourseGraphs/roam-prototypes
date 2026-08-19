# Properties Panel

Renders the `#.properties` block on discourse-node pages as a structured,
editable panel — a Notion-style lens over plain Roam blocks.

**The blocks remain the only store.** Every edit the panel makes is a plain
text block write in canonical form, so agents, search, backlinks, query
builder, multiplayer, and hand-editing all keep working. A "view as blocks"
toggle reveals the native subtree at any time.

## Status

Internal prototype for evaluation by Discourse Graphs. Ported from the
roam/js prototype (`DiscourseGraphs/dg-properties-panel`, v0.4.2) into this
repository's installable developer-extension form.

## Features

- Filled slots render as chips; unfilled template slots as ghost "+ add"
  affordances; a fill meter summarizes the block.
- Vocabulary-backed selects and multi-selects driven by the
  `[[roam/js/attribute-select]]` registry — including its dynamic options
  (`<%QUERYBUILDER:…%>`, `<%ACTIVEUSERS:…%>`), resolved by running the
  registry's options block as a SmartBlock, exactly as attribute-select
  does. Without SmartBlocks the dropdowns degrade to page-title
  autocomplete.
- Number slots get a slider/number editor honoring the declared range.
- Hyperlinks and block refs resolve in the display: `[label](url)` values
  render as link chips showing the label, bare URLs get compact handles
  (Linear issue keys, `repo#123`), and `((uid))` values show the referenced
  block's text. Stored raws are untouched; "edit as text" always shows the
  markdown verbatim.
- Out-of-vocabulary values are flagged (⚠) with a one-click fix suggestion —
  drift is surfaced, never auto-repaired.
- Single-colon `Key: value` lines render as read-only rows with live links;
  `{{…:SmartBlock:…}}` buttons keep working inside the panel.
- A title-level actions row with an extension point: other extensions call
  `window.dgPropsPanel.registerAction({ key, mount })` (re-registering on
  each `dgpp:ready` document event) to replace the built-in stubs — the
  Linear-Roam sync extension owns the "linear" slot this way.
- Dark mode for both native Roam (`.rm-dark`) and Roam Studio
  (`html.rs-dark`).

## Requirements

- The Discourse Graph plugin (node types under `discourse-graph/nodes/…`
  decide which pages get the panel).
- Optional: SmartBlocks + Query Builder for live dynamic dropdowns.

## Install

Load this developer-extension URL in Roam:

```text
https://discoursegraphs.com/releases/prototypes/properties-panel/
```
