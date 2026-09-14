# Roam Inbox

In-graph messaging for [Roam Research](https://roamresearch.com), with a signal.

Two halves of one feature, deliberately shipped together:

- **`/message`**: type it in any block, pick a person, and the block becomes
  `{{[[TODO]]}} [[+Person Name]] `, which matches `[[Convention/Inbox]]` verbatim.
- **A topbar badge** that counts messages addressed to you that arrived since you last looked. Click
  it for an inbox panel with **Open**, **Reply**, and **✓ Done** on every row.

Neither half works alone. A nicer send with no signal just grows the pile, and a badge nobody feeds
stays at zero. It is one bundle, so you cannot install half of it.

## Status

Internal prototype for evaluation by Discourse Graphs, piloted on the `dg-team` graph. Ported from
the roam/js prototype (`DiscourseGraphs/roam-inbox`, v0.5.1) into this repository's installable
developer-extension form. Check which build you are running with `roamInbox.debug()` in the browser
console.

## Why this exists

The `[[Convention/Inbox]]` convention worked on paper and rotted in practice. Measured on the
`dg-team` graph: 68 open messages across 7 people, the oldest from December 2024. That is only
about 4 per month per person, so volume was never the problem. Three things were:

1. **No signal.** The inbox was a Query Builder block nested under a collapsed heading on a
   personal home page, capped at 5 results. Nothing announced a message.
2. **The queue was hand-built per person.** Two active members had no `+Name` page and no inbox
   query at all. They were silently unmessageable and nobody noticed.
3. **"Read" and "done" were the same checkbox.** You could not acknowledge a message without
   declaring the underlying work finished, so messages sat as TODO forever and the inbox degraded
   into a backlog.

This fixes all three. The picker makes the `+` prefix invisible. The extension owns the query, so no
setup is required. The badge tracks *new since you looked*, while the checkbox keeps meaning
*handled*.

## The two channels

| you write | means | shows up in | badges? |
| --- | --- | --- | --- |
| `{{[[TODO]]}} [[+Name]]` (`/message`) | **addressed to** that person | their **Messages** tab | yes |
| `[[+Name]]` with no checkbox | cc / FYI | their **Mentions** tab | no |
| `{{[[TODO]]}} #[[Name]]` (`/task`) | **assigned work** | their **Tasks** tab | no |

The `+` is an addressing operator, not an accident. It is what separates "here is a message for
you" from "this block is about you". That distinction was never written down anywhere, which is how
`/task` and the inbox drifted into two disconnected channels. Tasks are shown but never badged: there
are far more of them, and a permanently large badge is not a signal.

## Install

Load this developer-extension URL in Roam, under **Load Developer Extensions from URL**:

```text
https://discoursegraphs.com/releases/prototypes/roam-inbox/
```

An inbox icon appears in the topbar next to the search box, and **Send message** appears in the
slash menu when you type `/message`.

To try a pull-request preview without touching your settings, put a loader in a `roam/js` block
instead. The published bundle is an ES module, so it cannot be pasted into a block directly, but it
can be imported by one:

```js
(async () => {
  const url = "https://discoursegraphs.com/releases/prototypes/roam-inbox/extension.js";
  const globalKey = "__roamInboxExtension";

  const previous = window[globalKey];
  if (previous?.onunload) await previous.onunload();

  const module = await import(`${url}?v=${Date.now()}`);
  const extension = module.default;
  if (!extension?.onload) throw new Error("The loaded module is not a Roam extension.");

  await extension.onload({ extensionAPI: undefined, extension: { version: "roam/js" } });
  window[globalKey] = extension;
})().catch((error) => console.error("Could not load Roam Inbox:", error));
```

Give each extension its own `globalKey`. Two loaders sharing one key will unload each other. This
path never receives a published `extension.css`, so the extension carries its stylesheet inside the
bundle and both paths look the same.

## Behaviour worth knowing

- **A fresh browser starts at zero, not at your backlog.** Everything already in your inbox is
  recorded as seen the first time the extension runs in a browser, so you get a clean badge instead
  of an accusatory 24. The panel still lists everything, and the icon carries a small muted dot so a
  non-empty inbox is still discoverable. A *number* is reserved for what is genuinely new, because a
  permanent count of everything open stops reading as a signal.
- **Addressing an existing block counts as a new message.** Most messages on `dg-team` are not
  typed into a brand-new bullet. Someone adds `[[+You]]` to a bullet that is already there, such as
  last week's meeting note or a thread from January. That is a new message to you even though the
  block is old, and it badges.
- **Messages you address to yourself do count.** `[[+You]]` is how several people already keep a
  personal todo queue. Measured on `dg-team`, 12 of the 68 open messages are self-addressed, and
  they are deliberate reminders, not noise. An earlier version filtered them out of the badge and
  silently under-reported those inboxes. You still will not get a *toast* for something you just
  typed; that exclusion lives at the toast.
- **Opening the panel clears the badge but keeps the blue "new" marks** for that viewing, so you can
  still see what arrived while you were away.
- **Replies are auto-addressed back to the sender.** Hitting **Reply** creates a child block
  pre-filled with `{{[[TODO]]}} [[+Sender]] `, so the thread notifies both ways instead of
  dead-ending in a nested bullet nobody queries.
- **Messaging someone with no `+Name` page just works.** The picker creates the page before
  inserting the link, so first-time recipients are not silently unreachable.
- **What you have seen lives in `localStorage`, not the graph.** Writing it on every panel open
  would churn edit-times and pollute the recency signals the team's weekly activity review reads.
  The cost is that it is per-browser.

## Customization

All knobs are in [`src/config.ts`](src/config.ts) and take effect at build time:

- **`insertFor`**: the inserted format. Default `{{[[TODO]]}} [[+Name]] `.
- **`replyStubFor`**: what **Reply** pre-fills. Return `""` for a plain empty child.
- **`ADDRESS_PREFIX`**: the `+` addressing character.
- **`LABEL`**: the slash-menu label ("Send message").
- **`POLL_MS`**: fallback refresh interval (default 60 s) if the pull watch does not fire.
- **`TIP_DELAY_MS`**: how long a hover waits before the tooltip appears (default 80 ms).
- **`ACTIVE_WITHIN_DAYS`** and **`EXCLUDE_PATTERNS`**: who is in the picker's browse list. Same
  semantics as `roam-task-assign`.

## How it works (for maintainers)

The source is split by concern. `picker.ts` is the `/message` half. `badge.ts`, `panel.ts`, and
`toast.ts` are the receive half; each subscribes to `inbox.ts`, which holds the lists and the seen
set, and repaints itself when the lists change. `roam.ts` is the only module that talks to the
graph. `live.ts` triggers refreshes. `lifecycle.ts` is load and unload, and `index.ts` wraps it in
`runExtension`.

- **The slash command** registers through `window.roamAlphaAPI.ui.slashCommand.addCommand`, which is
  real but undocumented. The callback returns `""`, which makes Roam delete the typed `/message`
  filter text; the callback context provides `block-uid` and `window-id`.
- **Two Roam editor traps, both verified live, shape the picker** (see `editor.ts`). First, the
  datascript store lags the textarea indefinitely while a block is being edited: after Roam strips
  the slash text, the textarea reads `""` while `:block/string` still reads `"/message"`, until the
  editor closes. So the picker waits for the textarea's own value to change, never for the store to
  agree with it. Second, `updateBlock` under an open editor gets clobbered when the editor later
  flushes its own stale value. So the insert is written through the textarea, with the native value
  setter plus a bubbling `input` event, which is exactly what typing does. It falls back to a store
  write only when no editor is mounted.
- **Every graph read is async** through `window.roamAlphaAPI.data.async.q`, as this repository
  requires. Pull results are read namespaced-key-first (`pick` in `roam.ts`): on some API surfaces
  the short key does not come back `undefined` but resolves to a ClojureScript internal, and reading
  short-first silently yields garbage that looks like an empty graph.
- **Two queries per refresh.** One pulls every open block that references `+Me`; messages and
  mentions are told apart by whether the block also references `TODO`. The other pulls open TODOs
  that reference `Me`, the `/task` channel. A refresh that finishes after a newer one started, or
  after unload, drops its result rather than overwriting fresher state.
- **"New" is tracked by message uid, not by timestamp.** A message becomes addressed to you when
  someone *edits* a block to add `[[+You]]`, and that block can be any age. An earlier build compared
  `:create/time` against a "last looked" clock, so a message added to an existing bullet arrived
  already read. Measured on `dg-team`: 65 open messages with create-times spanning Dec 2024 to Jul
  2026, so the whole standing backlog was permanently uncountable. `:edit/time` is not the fix
  either, because it moves on every later typo fix. A set of uids in `localStorage` has neither
  failure mode. It is capped at 2000 entries; measured traffic is about 4 per person per month.
- **Live updates** come from `addPullWatch` on the `+Me` page with pattern
  `[{:block/_refs [:block/uid]}]`, so any new block referencing you fires it. A 60 s poll runs
  alongside as insurance, not as the primary path. The poll skips while the tab is hidden and runs
  once as soon as the tab is shown again.
- **The badge count is anchored to an inner 16px `.rmi-glyph` span, not to the button.** The
  button's width is not stable (24px empty, 37px with a bubble, and a graph's `roam/css` can pad it
  further), so anchoring to the button pushes the badge out toward the neighbouring icon.
- **The inbox glyph is an inline SVG, not a Blueprint icon class.** `bp3-icon-inbox` renders nothing
  in Roam: Roam ships Blueprint's SVG icon components and not the per-icon font CSS, so the class
  resolved to an empty 16px box. Drawing it inline also survives a Blueprint version bump.
- **The re-mount observer watches the topbar's direct parent only**, with `subtree: false`. It is
  deliberately not on `document.body`, the busiest node in the app. A real page navigation does not
  replace the topbar. Every refresh re-checks the mount as a backstop.
- **Tooltips are hand-rolled.** The native `title` attribute waits about a second and cannot be
  styled, and Blueprint's tooltip is a React component with no imperative entry point.
- **Message text is flattened for display.** Block refs collapse before markdown links are
  stripped, because an alias whose target is a block ref is three levels of nested parentheses. The
  same flattening runs on the breadcrumb's page title, since in a discourse graph most pages are
  `[[ISS]] - …` or `[[QUE]] - …`.

## Diagnosing

`roamInbox.debug()` in the console reports the running version, who it thinks you are, whether the
pull watch is live, the three counts, what the badge should be showing, how many messages you have
acknowledged, and whether the newest one is unread. `hint` says in words why the badge looks the way
it does. It reads the current state; run `await roamInbox.refresh()` first to re-query the graph.

## Development

From the repository root, `pnpm --dir prototypes/roam-inbox test`, `typecheck`, and `build`.

- `tests/inbox.spec.ts` loads the extension against a fake graph and pins the unread count, which
  is the part that was wrong in earlier builds.
- `tests/bundle.spec.ts` imports the built `dist/extension.js` into jsdom and runs `onload` exactly
  as the roam/js loader block does. It skips until you have run `pnpm build`.
- `tests/interop.spec.ts` guards the source against default imports from `roamjs-components` and
  the legacy top-level `roamAlphaAPI` aliases.
- `pnpm typecheck` is opt-in; the repository has no shared typecheck step.

## Relationship to the sibling prototypes

The person picker is forked from **`roam-task-assign`** (the `/task` command), the same way
**`roam-feedback`** (`/feedback`) was. Both still live only in a local working folder, not on
GitHub. Each prototype has to stay independently installable, so they are copies rather than a
shared library. That is three copies of the picker now. If a fourth appears, extract a shared core.

Note for whoever touches `roam-task-assign` next: its `/task` picker waits for Roam's datascript
store to agree with the textarea before opening. That wait can hang indefinitely, for the reason
described under **How it works**. It has not been fixed there.

## Verification

The 0.5.x roam/js build was verified end to end on `sandbox-discourse-graphs`: slash command
registration and de-duplication, picker filtering, insert format, auto-creation of a missing
`+Name` page, pull-watch live refresh, badge clear-on-open with persistent new-marks, check-off,
auto-addressed reply, tooltip alignment, and dark theme. Query counts were cross-checked against an
independent datalog implementation on both `sandbox-discourse-graphs` (22 / 12 / 10) and `dg-team`
(24 / 15 / 14). Measured latency from a new message to the badge repainting was 2.6 s in a
throttled automation tab; the debounce itself is 300 ms.

The 0.6.0 port is verified by the unit tests and the built-bundle load check above. Its first live
run in Roam goes through the pull-request preview URL.
