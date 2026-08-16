---
name: roam-graph-data
description: Read and query Roam graph data in a prototype without coupling UI code to raw result shapes.
---

# Roam graph reads

Use this when a prototype reads pages, blocks, references, attributes, or the current graph selection.

1. Prefer a focused `window.roamAlphaAPI.pull(pattern, eid)` when the entity id is known.
2. Use `window.roamAlphaAPI.q(query, ...inputs)` for joins and discovery. Parameterize values instead of interpolating them into query strings.
3. Keep the query and result normalization in a small typed function. Return domain-shaped objects to React components.
4. Treat missing entities, deleted blocks, and empty results as normal states.
5. Query on events or bounded refreshes, not every render. Cancel or ignore stale async work during unload.

Roam pull attributes commonly include `:block/uid`, `:block/string`, `:block/order`, `:block/children`, and `:node/title`. Datalog results are tuples; document the tuple order beside the query.

Never send graph contents to an external service unless the prototype specification explicitly requires it and the public README explains it.
