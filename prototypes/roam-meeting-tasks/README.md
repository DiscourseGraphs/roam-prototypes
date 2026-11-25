# Meeting Tasks

The next actions carried over from past meetings, and the other open tasks on a recurring-meeting
page, shown inline wherever the page's widget sits.

## Status

Internal prototype for evaluation by Discourse Graphs, piloted on the `dg-team` graph's sync pages.
It replaces a `roam/render` component of the same behavior that lived entirely in one code block.
That component read the graph synchronously while Roam rendered the page: on `Sync / All Hands`
(26,728 blocks) each widget took 1.6 to 2.0 seconds, and a page mounts several. This version reads
after the page has rendered, shares one set of reads between all widgets on a page, and replaces
the slowest queries with direct lookups. See "Performance" below.

Check which build you are running with `roamMeetingTasks.debug()` in the browser console.

## What a widget shows

Place a widget with `{{meeting-tasks}}`
(see "Installing on a graph"). It is scoped to the page it sits on and has two modes.

**Page mode** (anywhere on the page that is not inside a meeting):

1. **Carried over from past next actions**: every TODO and DONE under a past meeting's "next
   actions" header, newest meeting first, dated.
2. **Other tasks on this page**: every other TODO and DONE on the page, collapsed by default so it
   cannot bury the first section. Tasks outside any meeting are labeled "inbox".

**Meeting mode** (inside a dated meeting block, such as a "last meeting" template slot): the first
section shows the next actions of the most recent earlier meeting that has any, with a link to that
meeting. The collapsed section shows open items from older meetings. Meetings dated on or after the
host meeting are ignored.

The mode is detected from the widget's position. A `page` argument shows page mode inside a meeting.

In both modes:

- Checkboxes write `{{[[TODO]]}}` / `{{[[DONE]]}}` back to the task's own block. A task often shows
  in two widgets at once. Both disable its checkbox while saving and reload after the write.
  Each save reads the current block text before changing its task marker.
- Use the **Reload tasks** icon at the right edge after editing tasks elsewhere or to retry a failed
  load. It appears on hover or keyboard focus and stays visible on touch screens. A successful
  reload shows a checkmark for about two seconds. If a checkbox save fails, the widget shows an error and you can retry.
- Items are listed newest meeting first, and in outline order within a meeting.
- A DONE item stays visible for 14 days, then ages out.
- Clicking an item opens it. Shift-click opens it in the right sidebar.
- The **From** link opens the source meeting block. Shift-click opens it in the right sidebar.
- Meetings use a 120-day lookback by default. When older meetings are excluded, hover, focus, or
  tap the information icon beside the older-items disclosure to see the window and hidden count.
  Tasks outside any meeting are always shown.

### Arguments

| argument | effect |
| --- | --- |
| a bare number, e.g. `365` | look back that many days instead of 120 |
| `page` | show page mode even inside a meeting |
| `debug` | show a diagnostic line, including how long the widget took to load |

Example: `{{meeting-tasks: 365, debug}}`.

## Graph conventions it relies on

- **Meeting**: a block on the page that references a daily-note page, such as
  `[[September 22nd, 2026]] #.sticky`. When any meeting on the page is tagged `#.sticky`, only tagged
  blocks count, which keeps prose that mentions a date from counting as a meeting.
- **Next-actions header**: a block one or two levels under a meeting that either references one of
  the `ℹ` tooltip blocks in `ANCHOR_UIDS` (`src/config.ts`), or is worded like a header: "next
  actions", "Actions", "Action items/for next time", "next steps", "Proposed next step", and close
  variants. The depth limit keeps prose such as "next steps for X" out of the results.
- **Task**: a block with a `{{[[TODO]]}}` or `{{[[DONE]]}}` marker. An item under a header that
  starts with a block reference, `((uid))`, and has no marker of its own stands for the block it
  references: the checkbox writes there, and the row shows the item's own text, including any note
  after the reference. Chains of wrappers are followed up to 4 hops.

`ANCHOR_UIDS` lists dg-team's anchor and akamatsulab's two "Proposed next step" anchors. Block uids
are unique per graph, so one list serves every graph.

## Installing on a graph

One graph-level loader serves every meeting block and template.

**1. Load the extension.** Either use **Load Developer Extensions from URL** with:

```text
https://discoursegraphs.com/releases/prototypes/roam-meeting-tasks/
```

or put a loader in a `roam/js` block, which loads it for everyone in the graph who has `roam/js`
enabled. To try a pull-request preview, change `url` to the preview URL posted on the pull request.

```js
(async () => {
  const url = "https://discoursegraphs.com/releases/prototypes/roam-meeting-tasks/extension.js";
  const globalKey = "__roamMeetingTasksExtension";

  const previous = window[globalKey];
  if (previous?.onunload) await previous.onunload();

  const module = await import(`${url}?v=${Date.now()}`);
  const extension = module.default;
  if (!extension?.onload) throw new Error("The loaded module is not a Roam extension.");

  await extension.onload({ extensionAPI: undefined, extension: { version: "roam/js" } });
  window[globalKey] = extension;
})().catch((error) => console.error("Could not load Meeting Tasks:", error));
```

The stylesheet is carried in the bundle, so neither loading path needs `extension.css`.

**2. Add the macro to a meeting block or template.** Use `{{meeting-tasks}}` on its own or include an enablement hint in the same block:

```text
{{meeting-tasks}} (if you are seeing this block, enable it here: ((SETUP_UID)))
```

Replace `SETUP_UID` with the UID of your graph's setup block. Before a user enables the loader, Roam displays the hint and its clickable block reference. Once loaded, the extension displays the widget in their place. Use one macro per block. Existing arguments go inside the braces, for example `{{meeting-tasks: 365, page, debug}}`.

Existing `roam/render` invocations can still use the shared shim in `src/shim.ts`. The macro uses the same widget and needs only the loader.

## Performance

Measured on `dg-team`'s `Sync / All Hands` (26,728 blocks, 120 meetings, 18 in the 120-day window):

| | roam/render component | this extension |
| --- | --- | --- |
| when reads run | during Roam's render, synchronously | after the widget has rendered |
| cost per widget | 1.6 to 2.0 s (9 queries) | 90 to 320 ms for the first widget on a page; widgets that reuse its reads, 2 to 3 ms |
| collapsed section | built on every render | read and rendered only when opened |
| block references in item text | one query per reference | one batched read, only for visible rows |

Most of the old cost came from four Datalog queries that bind a variable from a list, such as
`:in $ [?mu ...]` followed by `[?m :block/uid ?mu]`. DataScript answers those by scanning the whole
attribute rather than looking each value up, so each took 230 to 360 ms however few rows it
returned. They are now `pull_many` calls. The page-wide scans for meetings and for TODO/DONE blocks
start from the `.sticky`, `TODO`, and `DONE` pages' reverse references instead, which are index
reads. Those references are compared by entity id first, so only the blocks on this page are pulled
in full. Meetings are read two levels deep, and only the next-actions headers in full.

Output was compared with the old component on all 20 widgets on the three dg-team sync pages
(`All Hands`, `Roam Product`, `Protocol Product`). Version 0.1.0 matched on every widget. In 0.2.0,
4 widgets match and the rest differ only by the two meeting-mode fixes listed below: 15 no longer
list the host meeting's or newer meetings' tasks as "older open items", and 1 now shows "From last
meeting" where the old component showed nothing.

## Changes from the roam/render component

Behavior is kept on purpose. These differ:

- The "From last meeting" label no longer shows the date's link brackets (`[[September 22nd, 2026]]`
  is now `September 22nd, 2026`), and the date links to the meeting.
- Meeting mode looks only at earlier meetings. Before, a task listed under last meeting's next
  actions and carried into this meeting's next actions dropped out of "From last meeting", and tasks
  from this meeting and newer ones were listed as "older open items".
- "Last meeting" is the most recent earlier meeting with at least one task under its next actions.
  Before, a meeting whose next-actions header was left empty was chosen, and the section was hidden.
- Within a meeting, items follow outline order. Before, they were sorted by edit time, so checking
  a box moved the item to the top on the next load.
- An item like `((uid)) --> by Friday` shows the note after the reference. Before, the note was lost.
- Item text drops tooltips, buttons, videos, and other `{{components}}`; a labelled block reference
  `[label](((uid)))` shows its label; `mailto:` links show their text.
- Block references inside item text are resolved through chains (a reference to a block that is
  itself a reference). The old component resolved one level and showed the inner `((uid))`.
- A wrapper that points to another wrapper is followed to the task. The old component dropped it.
- Forcing `meeting` mode outside a meeting shows page mode. The old component threw.
- A task block with no edit time is included; if it is DONE, it counts as older than 14 days. The
  old queries silently skipped such blocks. Only very old imported blocks lack an edit time.
- The collapse arrow turns (`▸` to `▾`) when the section is open.

## Development

```text
pnpm test        # vitest: model, text rules, the shim, and the built bundle
pnpm build
pnpm typecheck   # opt-in strict check
```

`src/index.ts` lists the modules. `roam.ts` is the only module that touches the graph; `model.ts`
and `text.ts` are pure and hold every rule above.
