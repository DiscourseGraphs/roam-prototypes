---
name: roam-graph-data
description: Read and query Roam graph data in a prototype without coupling UI code to raw result shapes.
---

# Roam graph reads

Use this when a prototype reads pages, blocks, references, attributes, or the current graph selection.

1. Prefer the promise-returning namespace for new extensions: `await window.roamAlphaAPI.data.async.pull(pattern, eid)` when the entity is known and `await window.roamAlphaAPI.data.async.q(query, ...inputs)` for joins and discovery.
2. Use `await window.roamAlphaAPI.data.async.pull_many(pattern, eids)` instead of a loop of individual pulls.
3. Use `await window.roamAlphaAPI.data.async.fast.q(...)` only after profiling. It returns proxy-wrapped, read-only results whose key access and console behavior differ from normal query results.
4. Consider `await window.roamAlphaAPI.data.backend.q(...)` for expensive queries that should run off the main thread, while accounting for backend sync lag and local fallback.
5. Parameterize Datalog inputs instead of interpolating values into query strings. Query and pull variants time out after 20 seconds unless their documented timeout option is overridden.
6. Keep the query and result normalization in a small typed function. Treat missing entities, deleted blocks, empty results, timeouts, and rejected promises as normal states.
7. Query on events or bounded refreshes, not every render. Cancel or ignore stale async work during unload.

Roam pull attributes commonly include `:block/uid`, `:block/string`, `:block/order`, `:block/children`, and `:node/title`. Datalog results are tuples; document the tuple order beside the query.

The synchronous `window.roamAlphaAPI.data.q`, `data.pull`, and `data.fast.q` paths still exist, but the official documentation says new extensions should prefer `data.async.*`. The older top-level `window.roamAlphaAPI.q` and `window.roamAlphaAPI.pull` names are legacy aliases and must not appear in new prototype code.

Never send graph contents to an external service unless the prototype specification explicitly requires it and the public README explains it.
