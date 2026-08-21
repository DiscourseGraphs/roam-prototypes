# Copy for LaTeX — design

> **Provenance.** Written while this prototype lived at `copy-for-latex/` inside the
> `dg-prototypes` repository. It has since been extracted to its own repository, so paths
> written below (`copy-for-latex/test/...`, `docs/superpowers/...`) describe the layout at
> the time. The code they refer to is now at the root of this repo, with tests under `test/`.
> The text is left as written: it is the record of what was decided, not current instructions.

**Date:** 2026-08-04
**Status:** approved, ready for implementation planning
**Roam source:** `[[ISS]] - send evd + citation to your authoring platform` (uid `5Ckq7OEJX`), drafted on the August 4th, 2026 daily note (uid `KPDRUJ1P8`)
**Related:** `[[Project/Legacy documents to and from discourse nodes]]`, `[[ISS]] - Knowledge package manager`

## Problem

A researcher outlines a manuscript in Roam out of discourse nodes, then writes the manuscript in Overleaf. Moving one node into the draft currently takes three manual steps: copy the node's content, copy its citekey, paste each into LaTeX. The `Story/PINN for accurate 3D segmentation of cellular membranes` outline is the worked example — a Results section built from a Question, an Evidence node citing prior work, and an internal analysis page.

The target output for one Evidence node is a LaTeX sentence carrying its own citation:

```latex
Uniform constriction forces on a simulated 3D membrane tube led to
asymmetric pinched tube deformation\autocite{vasan2020mechanical}.
```

## Decisions

These were settled during design. Each records the alternative that was rejected, so the implementer does not relitigate them.

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Copy the node's content **verbatim**, deterministically | LLM rewording into flowing prose. Deferred: the payload builder stays a pure function so a rewording layer can sit on top later. |
| 2 | Emit **clean text only** — no provenance comment, no wrapper macro | A `%` comment carrying node uid and Roam URL. Recorded as a deliberate tradeoff: once text lands in Overleaf the tie back to the graph is gone, and sync-back would need text matching. The payload builder must stay pluggable so this can be added without redesign. |
| 3 | Trigger is **right-click on a discourse-node page reference** in an outline | The block context menu, the multi-select context menu, and a page-level button. All are supported APIs and all were declined in favor of the gesture that matches where drafting actually happens. Dedicated node-specific affordances are named as future work. |
| 4 | A node with no usable citekey copies **without a citation**, with a toast naming the node | Per-node-type rules, and refusing to copy. The universal rule is simpler and nothing this tool emits should ever fail to compile. |

## Verified API surface

Established by reading the installed typings and the Discourse Graph plugin source, not by assumption.

- `roamAlphaAPI.ui` exposes `commandPalette` (which accepts `default-hotkey`), `blockContextMenu`, `msContextMenu`, and `individualMultiselect.getSelectedUids()`. Declared in `roamjs-components/types/index.d.ts:153-181`.
- **There is no API for Roam's page-reference context menu.** The menu shown in the UX1 mockup, with "Jump to page" and "Delete reference", cannot be extended through a public interface.
- The two native items worth replicating do have APIs: `ui.mainWindow.openPage` and `ui.rightSidebar.addWindow`, declared in the same file at lines 345 and 131.
- The Discourse Graph Roam plugin already observes `span.rm-page-ref` elements and tests each one with `findDiscourseNode`, which is how the discourse context overlay attaches. See `apps/roam/src/utils/pageRefObserverHandlers.ts:14,100`.
- `extractContentFromTitle` already splits `{content}` out of a node's format string, and the same regex match yields `{Source}` by placeholder index. See `apps/roam/src/utils/extractContentFromTitle.ts`.
- Source pages carry `citekey` and `doi` in front matter but no BibTeX entry, so the bibliography entry cannot be copied alongside the citation without a Zotero round-trip.

The last point sets a prerequisite: **the pasted `\autocite{key}` only compiles if the key is already in the Overleaf project's bibliography.** The prototype assumes Zotero is wired to Overleaf and the keys match.

That assumption holds by design here. Citekeys in these graphs are deliberately written in Better BibTeX style for exactly this purpose, so the `@citekey` page title is the LaTeX key with the `@` removed and needs no translation. Graphs that do not follow that convention are out of scope; see future work.

## Scope

**In scope.** Right-click a discourse-node page reference in a Roam outline, get a menu, copy that node as a LaTeX sentence with its citation.

**Out of scope, each a real follow-on:** the node-page button (UX2), the Overleaf integration (UX3), "Send to…", LLM rewording, provenance comments, BibTeX export, and multi-node selection.

## Where it lives

A standalone `roam/js` prototype at `copy-for-latex/extension.js`, following the existing `roam-inbox` and `roam-feedback` prototypes in this repository. It runs live in a graph with no build or deploy step, so it can be iterated in `sandbox-dg` and put in front of a pilot user the same day.

The cost is that it cannot import the plugin's internals, so it re-implements two small pieces:

1. A `MutationObserver` over `span.rm-page-ref`.
2. Format-to-regex parsing, reading node formats from the `discourse-graph/nodes/*` pages.

Both are throwaway. If the gesture proves out, porting into the plugin is mechanical, because the equivalent utilities already exist there.

## Component 1 — the payload builder

One pure function. Everything else is plumbing.

```
nodeTitleToLatex(title: string, format: string) -> { latex: string, warning?: string }
```

It parses the title against the node's format, extracts `{content}` and `{Source}`, converts Roam markup to LaTeX, and assembles the sentence.

### Assembly rule

```
{converted content}\autocite{key}.
```

No space before `\autocite`. The period sits outside the closing brace so biblatex can shift punctuation. Any period already ending the node content is stripped first, so `..` can never occur.

When the source slot does not parse as a citekey, emit `{converted content}.` and return a warning naming the node.

### Markup conversion

This is the substance of the function and nearly all of the risk. Node content is Roam markup. Pasting it raw into LaTeX corrupts the document silently rather than failing loudly: a node reading "50% of cells showed..." becomes a LaTeX comment at the `%`, and the remainder of the sentence disappears from the compiled PDF with no error.

| Roam input | LaTeX output | Note |
|---|---|---|
| `% & _ # $ { } ~ ^ \` in prose | escaped | Must not escape inside math. This is the highest-risk rule. |
| `$$x$$` | `$x$` | Roam uses `$$` for inline math; LaTeX `$$` is display math. Node titles do carry math in practice. |
| `**bold**` | `\textbf{bold}` | |
| `__italics__` | `\textit{italics}` | Roam italics is double underscore, not asterisks. |
| `^^highlight^^` | `highlight` | Markers dropped; no highlight package can be assumed. |
| `[[Page Name]]` | `Page Name` | Brackets unwrapped, inner text kept. |
| `#tag` | removed | Including `#.class` styling tags. |
| `((block-uid))` | the referenced block's text | Resolved, then converted by the same rules. |

### Citekey extraction

The `{Source}` capture is expected to look like `@vasan2020mechanical` or `[[@vasan2020mechanical]]`. Strip brackets and the leading `@` to get the key. If what remains contains characters illegal in a BibTeX key, or the slot is empty, treat it as having no citekey and take the warning path. An internal analysis page such as `@analysis/measure how radially isotropic membrane curvature is at membrane budding sites` must take the warning path, not be emitted as a citation.

## Component 2 — the reference observer

A `MutationObserver` over `span.rm-page-ref` elements. For each one, read the page title from `data-tag` or the parent's `data-link-title`, and test it against the graph's node formats. Mark matches with a data attribute so they can be styled and so the menu handler can identify them cheaply.

Two conditions from the plugin's own observer are worth copying: skip a span whose parent is itself inside a `.rm-page-ref`, and skip spans inside `.rm-title-display`, so the menu does not attach to page titles.

Results should be cached by title, since a long outline re-renders these spans frequently.

## Component 3 — the menu

On `contextmenu` over a marked reference: call `preventDefault`, then render a Blueprint menu at the cursor position.

```
Copy for LaTeX
Copy as hyperlink
─────────────────
Jump to page
Open in sidebar
```

References that are not discourse nodes keep Roam's native menu untouched, so nothing changes anywhere else in the graph.

- **Copy for LaTeX** writes `nodeTitleToLatex` output to the clipboard, and raises a toast on the warning path.
- **Copy as hyperlink** writes `[node title](roam-url)` for pasting into Slack, Linear, or a document.
- **Jump to page** and **Open in sidebar** replicate the native items through `roamAlphaAPI.ui.mainWindow.openPage` and `roamAlphaAPI.ui.rightSidebar.addWindow`.

Known loss: on a discourse-node reference the remaining native items, notably "Delete reference", are no longer reachable by right-click. They stay available from the bullet's own context menu.

The menu must close on outside click and on Escape, and must position itself within the viewport when the reference sits near a window edge.

## Testing

**Unit tests** on `nodeTitleToLatex`, which is pure and needs no Roam runtime. Following the `roam-inbox/test` pattern. One case per markup-conversion rule, plus:

- Each node type in use: Evidence, Result, Question, Claim.
- The no-citekey path, for an empty source slot and for an `@analysis/...` source.
- Content already ending in a period.
- The `50% of cells` case specifically, since it is the silent-corruption example.
- Content containing math alongside prose that needs escaping, confirming escaping stops at the math delimiters.

**Manual verification** in `sandbox-dg` against real nodes, then one end-to-end check that a copied sentence compiles in the `Story/PINN` Overleaf project and renders the citation correctly.

## Future work

Recorded so the sequence is visible, not because any of it is planned now.

1. Dedicated node-specific affordances on the reference, beyond a context menu.
2. Multi-node copy over a selection, using `msContextMenu` and `individualMultiselect.getSelectedUids()`. This is the natural fit for copying a whole Results section, and both APIs are already supported.
3. The node-page button and "Send to…", which connects to the existing Overleaf push bridge in `synched-manuscript-template/bridge/OVERLEAF-PUSH.md`.
4. LLM rewording, which merges several nodes into one sentence with a combined `\autocite{a,b}`. This is what the original mockup actually shows.
5. Provenance, revisiting decision 2. This is the citation-back half of the knowledge package manager and the answer to "what would it mean to make discourse graph data explicit in a LaTeX document".
6. Per-node-type citation rules, revisiting decision 4, so that a Result is understood to need no citation rather than being reported as a missing one.
7. Carrying the BibTeX entry along, which removes the wired-Zotero prerequisite.
8. A more accommodating citekey translator, for users whose citekeys are not written in Better BibTeX style. Nothing to build until such a user appears, since the convention is deliberate in the graphs this prototype targets.
