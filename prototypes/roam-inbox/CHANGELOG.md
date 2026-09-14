# Changelog

## 0.6.0 - 2026-09-10

- Ported into this repository as an installable developer extension: an ES
  module built with the shared esbuild CLI, loaded from a URL or imported by a
  `roam/js` block. Earlier versions were a single pasted `roam/js` file in the
  private `DiscourseGraphs/roam-inbox` repository.
- Every graph read now goes through `window.roamAlphaAPI.data.async.*` and
  every write through `data.block.*` and `data.page.*`. Datalog inputs are
  parameterized.
- Two queries per refresh instead of three: messages and mentions come from
  one query over `+Me` and are told apart by the `TODO` reference. Each row
  pulls only its direct parent instead of every ancestor.
- `roamInbox.debug()` now reads the current state synchronously. The new
  `await roamInbox.refresh()` re-queries the graph first.
- A refresh that finishes after a newer one started, or after unload, drops
  its result. The fallback poll pauses while the tab is hidden and runs once
  when the tab is shown again.
- The topbar observer now attaches whenever the badge first mounts, not only
  when the topbar already existed at load.
- Hovering a picker entry moves the highlight instead of rebuilding the list.
- Fixed: a hashtag-form address (`#[[+You]]`) left a stray `#` in panel rows.
- Fixed: the one-second badge mount retry was not cancelled on unload.
- Tests moved to vitest: the unread-count cases from the roam/js build, text
  flattening, result shaping, a source guard against default imports from
  `roamjs-components` and legacy `roamAlphaAPI` aliases, and a built-bundle
  load check that runs `onload` the way a `roam/js` loader block does.

## 0.5.1 - 2026-07 (roam/js, before this repository)

- The inbox glyph is an inline SVG. Blueprint's `bp3-icon-inbox` class
  renders nothing in Roam, which left the badge floating over an empty box.

## 0.5.0 - 2026-07 (roam/js, before this repository)

- "New" is tracked by message uid rather than by comparing `:create/time`
  against a "last looked" clock. The clock made every message added to an
  existing block arrive already read, which pinned the badge at zero for the
  whole standing backlog.

## 0.4.0 - 2026-07 (roam/js, before this repository)

- Initial pilot on `dg-team`: `/message` picker, topbar badge, inbox panel
  with Open, Reply, and Done, toasts, and the fallback poll.
