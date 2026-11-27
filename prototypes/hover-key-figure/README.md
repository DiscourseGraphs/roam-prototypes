# Hover Key Figure

Presentation-ready key-figure preview for discourse nodes in the Roam outliner: hover a discourse-node reference, click the **🖼 Figure** chip, see the node's key figure in a pinned card; click the image to expand it full-screen.

Built for presenting nodes during a live discussion (journal club, lab meeting, weekly recap): nothing is added to the page at rest, the card stays where it opened while you talk over it, and the lightbox is audience-sized.

## Status

Internal prototype for evaluation by Discourse Graphs. Executes the outline half of [PRO-50 Node info hover preview](https://linear.app/discourse-graphs/issue/PRO-50/node-info-hover-preview) / DES-85; the request inventory and Linear state live in the `dg-prototypes` dossier (`roam-discourse-hover-metadata/CONTEXT.md`). Design details: [SPEC.md](SPEC.md).

## What it does

- **Hover** a reference to a discourse node (`span.rm-page-ref` whose title matches one of the graph's `discourse-graph/nodes/*` formats) for ~150 ms → a small floating **🖼 Figure** chip appears next to it. No layout shift; one singleton chip serves the whole page.
- The hover also **prefetches** the node's key figure, so the click answers instantly. If the page has no figure, the chip mutes and says so.
- **Click the chip** → a pinned card anchored at the reference shows the key figure with the node title as a one-line caption. `Esc`, click-outside, or clicking the chip again dismisses it.
- **Click the image** → full-viewport lightbox (like Roam's native image expand). `Esc` or click closes it back to the card.

## How the key figure is resolved

1. **Manual key image** — the page's Roam props (`discourse-graph` → `keyImage`), where [ENG-2123](https://linear.app/discourse-graphs/issue/ENG-2123) decided manual key images will live. Read leniently; wins when present.
2. **Automatic** — a port of the plugin's `findFirstImage` semantics: the first markdown image in the page's own blocks, **including images reached through `((block refs))` and `{{[[embed]]: ((uid))}}` trees** (the cases the AICS evidence import missed), children in document order, cycle-guarded.

Resolutions are cached per page for 5 minutes.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Hover delay (ms) | 150 | dwell time before the chip appears |
| Extra title pattern | — | optional regex; matching titles also get the chip (e.g. `^@` for source pages) |

With zero configured node types (Discourse Graph plugin absent), eligibility falls back to the `[[XXX]] - …` title convention.

## Install

Load this developer-extension URL in Roam (Settings → Extensions → Developer → *Load from URL*):

```text
https://discoursegraphs.com/releases/prototypes/hover-key-figure/
```

While the PR is open, use the preview URL from the **Roam prototype previews** PR comment instead.

## Development

```bash
pnpm --dir prototypes/hover-key-figure test   # 34 tests, incl. a dist smoke test on the roam/js load path
pnpm --dir prototypes/hover-key-figure build
pnpm exec tsc -p prototypes/hover-key-figure/tsconfig.check.json   # opt-in strict typecheck
```

Build before test to include the dist smoke test (it skips itself when `dist/` is absent).
