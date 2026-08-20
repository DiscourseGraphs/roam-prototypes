# Changelog

## 0.1.1 - 2026-08-20

- Chip now appears centered just below the pointer instead of at the reference's right edge, and the figure card anchors to the chip — long node titles no longer force mouse travel to reach the affordance (first live-test feedback).

## 0.1.0 - 2026-08-20

- v1 implementation: hover chip on discourse-node references (event delegation, singleton, zero layout shift), pinned figure card, full-viewport lightbox, Esc unwinding.
- Key-figure resolution: manual `discourse-graph.keyImage` prop (ENG-2123 forward-compat) with precedence over the automatic first-image walk (embeds, block refs, children, cycle guard); 5-minute per-page cache with hover prefetch.
- Node-type eligibility from the graph's `discourse-graph/nodes/*` formats, with a `[[XXX]] - …` fallback and an extra-pattern setting.
- Tests: 34 (unit + a dist smoke test on the roam/js load path); opt-in strict typecheck via `tsconfig.check.json`.

## 0.0.0 - 2026-08-20

- Created the Hover Key Figure prototype scaffold.
