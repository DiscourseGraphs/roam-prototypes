# zoteroRoam (MCP fork)

**This is a fork, not an original prototype.** It vendors [8bitgentleman/zotero-roam](https://github.com/8bitgentleman/zotero-roam) at v0.7.29, which is itself a fork of [alixlahuec/zotero-roam](https://github.com/alixlahuec/zotero-roam) (Apache-2.0, see `LICENSE`). On top of the upstream extension it adds **experimental headless MCP capabilities**: the extension registers AI tools with Roam, so that agents connected through [Roam's MCP server](https://github.com/Roam-Research/roam-tools) can search the Zotero library and import items into the graph without touching the UI.

Everything else is unchanged upstream zoteroRoam: the search panel, page menus, SmartBlocks commands, and settings all work as documented upstream.

## Status

Internal prototype for evaluation by Discourse Graphs. The Roam API it builds on (`extensionAPI.ai.addTool`) is marked experimental by Roam and requires a Roam Desktop build with extension AI tools (Local API 1.1.5 or later). On older builds the tools are simply not registered and the extension behaves like the upstream release.

## What it adds

Once the extension is loaded and configured (Zotero API key plus library, as in upstream zoteroRoam), three tools appear in the `extensionTools` field of the Roam MCP's `get_graph_guidelines`, callable via `call_extension_tool`:

- **`zotero-search-items`** (read): search the loaded Zotero items by citekey, DOI, Zotero item key, or title substring. Returns compact summaries, including each item's citekey and whether it already has a Roam page.
- **`zotero-import-metadata`** (edit): the headless equivalent of the "Import metadata" button. Creates the item's `[[@citekey]]` page if needed and imports its metadata using the user's configured settings (default formatter, custom function, or SmartBlock). Refused by default if the page already has content, to avoid duplicate imports; pass `allowDuplicate: true` to override.
- **`zotero-import-notes`** (edit): the headless equivalent of the "Import notes" button. Imports the item's notes and PDF annotations, formatted with the user's notes and annotations settings.

The typical agent flow: a paper is already in Zotero. Call `zotero-search-items` to find its citekey and check `inGraph`, then `zotero-import-metadata` to create the citekey page with metadata.

The tools read the user's current settings at call time and write to the graph exactly as the corresponding buttons would. Handler errors (unknown citekey, item without notes, page already populated) are returned to the agent as instructive messages.

## Where the MCP code lives

All additions are in [`src/services/ai-tools/`](src/services/ai-tools/), which holds the tool specs, handlers, and registration. They are wired up in [`src/loader.tsx`](src/loader.tsx) with feature detection. There is also a small `hasBlockChildren` helper and the `ai` namespace typings in [`src/services/roam/`](src/services/roam/). Searching the codebase for `registerAiTools` finds every touchpoint.

## Deviations from repository conventions

This prototype vendors a mature upstream codebase rather than starting from `packages/extension-base`, so it deliberately keeps upstream's conventions instead of this repository's:

- It builds with its own Vite config (`dev/vite.config.mts`, adapted from upstream) instead of the shared esbuild CLI, and uses upstream's lifecycle export instead of `runExtension`.
- Upstream code uses synchronous `window.roamAlphaAPI.data.q`. Only the files under `src/services/ai-tools/` are new code.
- Tests are upstream's vitest suite (`*.test.ts`, run by this package's `test` script) plus the tests for the new AI-tools service.

The build output honors the artifact contract: `dist/extension.js` (an ES module with a default `{onload, onunload}` export) and `dist/extension.css`.

## Upstreaming

The MCP capability was developed on the fork's own history first (branch `feat/roam-mcp-ai-tools` of 8bitgentleman/zotero-roam), so it can be offered upstream as a PR independently of this vendored copy.
