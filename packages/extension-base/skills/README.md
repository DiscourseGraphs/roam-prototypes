# Roam prototype guidance

These compact references give coding agents the repository's preferred Roam patterns. They are guidance, not shared runtime code. They were last checked against the official [Roam Alpha API](https://roamdocs.fyi/developer-documentation/roam-alpha-api) and [Roam Depot/Extension API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api) documentation on 2026-08-16.

Read only the skill relevant to the feature being implemented. Treat top-level APIs such as `roamAlphaAPI.q`, `roamAlphaAPI.pull`, and `roamAlphaAPI.createBlock` as legacy aliases. New extension code should use the namespaced APIs documented below and feature-detect uncertain additions with `window.roamAlphaAPI.apiVersion`.

- `graph-data`: query and normalize graph data.
- `graph-writes`: create and update pages and blocks safely.
- `commands-navigation`: register commands and navigate Roam UI.
- `react-rendering`: mount React UI into Roam and clean it up.
