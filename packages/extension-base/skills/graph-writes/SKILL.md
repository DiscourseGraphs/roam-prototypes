---
name: roam-graph-writes
description: Create, update, move, and delete Roam pages or blocks with explicit user intent and safe identifiers.
---

# Roam graph writes

Use this before changing the user's graph.

1. Resolve pages and blocks by UID; do not use visible text as identity.
2. Let Roam generate UIDs unless one must be known before the write. In that case use `window.roamAlphaAPI.util.generateUID()`.
3. Use the current namespaced block APIs: `data.block.create`, `data.block.update`, `data.block.move`, `data.block.delete`, `data.block.fromMarkdown`, and `data.block.reorderBlocks`.
4. Use the current namespaced page APIs: `data.page.create`, `data.page.update`, `data.page.delete`, and `data.page.fromMarkdown`.
5. Await every write and handle rejection. Write promises resolve after Roam applies the operation but before React necessarily re-renders.
6. Preserve sibling order intentionally. Block locations require `parent-uid` and an `order`, which may be an index, `"first"`, or `"last"` where documented.
7. All writes share Roam's rate limit of 1,500 calls per 60 seconds. For large imports, prefer the markdown APIs over one write per block.
8. Require an explicit user action for destructive or bulk writes. Show scope before execution and a useful completion/error message afterward.

Do not use the legacy top-level aliases `createBlock`, `updateBlock`, `moveBlock`, `deleteBlock`, `createPage`, `updatePage`, or `deletePage` in new prototype code.

Keep write functions separate from rendering. Validate all external or model-produced text before placing it in the graph. Do not persist credentials or sensitive service responses in pages, blocks, extension settings, or logs.
