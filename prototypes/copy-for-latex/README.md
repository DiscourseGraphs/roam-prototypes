# Copy for LaTeX

Copy a discourse node out of Roam as a LaTeX sentence carrying its own citation, or as a
hyperlink. Built for the case where a manuscript is outlined in Roam and written in Overleaf.

## Status

Internal prototype for evaluation by Discourse Graphs.

## What it does

Right-click a discourse node in either of two places:

- a reference to it inside a block's text, anywhere in an outline
- the heading of its own page, once you have opened it

A menu appears in place of Roam's:

```text
Copy for LaTeX
Copy as hyperlink
─────────────────
Jump to page
Open in sidebar
```

**Copy for LaTeX** copies the node's content as a sentence with `\autocite{...}` built from its
Source:

```latex
Uniform constriction forces on a simulated 3D membrane tube led to
asymmetric pinched tube deformation\autocite{vasan2020mechanical}.
```

The content is copied verbatim, never reworded. Roam markup is converted: `**bold**` becomes
`\textbf{}`, `__italic__` becomes `\textit{}`, `$$math$$` becomes inline math, page links are
unwrapped to their text, and tags are dropped. Everything else is escaped, so a stray `%` or `&`
cannot corrupt the document it is pasted into.

**Copy as hyperlink** copies `[label](roam-url)` for pasting into Slack, Linear, or a doc. The
label drops the node-type marker and the brackets around the citekey. If the page's uid cannot be
found it falls back to the bare label with no link.

**Jump to page** and **Open in sidebar** match Roam's own items of the same name. Jump to page is
left out when you right-click the heading of the page you are already on, since it would go
nowhere; from a sidebar heading it stays.

## Requirements and limits

- The pasted `\autocite{key}` only compiles if the key is already in the Overleaf project's
  bibliography. Citekeys are expected to be Better BibTeX style, so an `@citekey` page title is
  the LaTeX key with the `@` removed. Graphs that use another convention are out of scope.
- A node whose Source is not a usable citekey still copies, without the citation, and a toast
  names the node so the gap does not pass unnoticed. Nothing this emits should ever fail to
  compile.
- Only nodes it recognizes are intercepted. Right-clicking any other page reference, or the
  heading of any other page, leaves Roam's own menu untouched.
- One node at a time. There is no multi-select.
- Node types are read once at load, from `discourse-graph/nodes/{Type}` pages. Add a node type
  and you will need to reload for it to be recognized.

## Install

Load this developer-extension URL in Roam, under **Load Developer Extensions from URL**:

```text
https://discoursegraphs.com/releases/prototypes/copy-for-latex/
```

To try a pull-request preview without touching your settings, put a loader in a `roam/js` block
instead. The published bundle is an ES module, so it cannot be pasted into a block directly, but it
can be imported by one:

```js
(async () => {
  const url =
    "https://discoursegraphs.com/releases/prototypes/copy-for-latex/extension.js";
  const globalKey = "__copyForLatexExtension";

  const previous = window[globalKey];
  if (previous?.onunload) await previous.onunload();

  const module = await import(`${url}?v=${Date.now()}`);
  const extension = module.default;
  if (!extension?.onload) throw new Error("The loaded module is not a Roam extension.");

  await extension.onload({ extensionAPI: undefined, extension: { version: "roam/js" } });
  window[globalKey] = extension;
})().catch((error) => console.error("Could not load Copy for LaTeX:", error));
```

Give each extension its own `globalKey`. Two loaders sharing one key will unload each other.

Note that this path does **not** get a published `extension.css` — Roam only injects that when it
loads an extension from a URL itself. This extension therefore carries its own styles in the
bundle, so both paths behave the same. Any prototype that ships CSS as a separate file will look
broken when loaded this way.

Note also that **default imports from `roamjs-components` do not work** in this build. It is a
CommonJS package, and esbuild's ESM output resolves a default import of a CommonJS module to the
whole module object, so the value arrives as `{ default: fn }` and calling it throws. Use named
imports. Unit tests will not catch it, because vitest resolves CommonJS with ordinary interop.

If nothing happens on right-click, open the console. The extension logs how many discourse node
types it loaded, and warns when it finds none.
