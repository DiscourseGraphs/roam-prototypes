---
name: roam-graph-writes
description: Create, update, move, and delete Roam pages or blocks with explicit user intent and safe identifiers.
---

# Roam graph writes

Use this before changing the user's graph.

1. Resolve pages and blocks by UID; do not use visible text as identity.
2. Generate new UIDs with `window.roamAlphaAPI.util.generateUID()`.
3. Use the documented async write APIs such as `createPage`, `createBlock`, `updateBlock`, `moveBlock`, and `deleteBlock`.
4. Await each write and handle partial failure. For multi-step changes, validate parents first and keep enough state to explain or undo what happened.
5. Preserve sibling order intentionally. Never assume a new block's order.
6. Require an explicit user action for destructive or bulk writes. Show scope before execution and a useful completion/error message afterward.

Keep write functions separate from rendering. Validate all external or model-produced text before placing it in the graph. Do not persist credentials or sensitive service responses in pages, blocks, extension settings, or logs.
