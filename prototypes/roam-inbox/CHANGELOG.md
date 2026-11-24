# Changelog

## 0.7.0-beta.1 - Unreleased

- Replaced thread action labels with a persistent expand/collapse chevron and compact resolve/reopen controls. The resolve control appears on hover or focus, and stays visible on touch.

- Added a page discussion rail with separate topics, native comment replies, and shared resolve/reopen status.
- Open discussions from the command palette, a block’s Plugins menu, or the existing inbox panel.
- Discussions use Roam’s typography, link blue, and indented reply guides. Comment badges align at the right edge of each row, with the current source highlighted.
- Added source-block navigation, Open/All/Resolved filters, and persistent badges that include resolved threads.
- Open discussions in a floating panel that preserves page wrapping and scroll position. Click another block’s badge to focus it in the open panel. With the panel closed, click for inline comments or Shift-click for the panel.
- Group page discussions by source block, bring the selected block to the top, and show thread counts on each filter.
- Open the page rail directly from inline comments on touch screens.
- Recover unsent drafts after a reload in the same tab and prevent a second submission when switching views during a post.
- Keep unsent drafts when switching views or when a comment fails to post.
- New threads post to the block shown in the picker. If someone resolves a thread while you write, your reply stays in drafts until you reopen it.
- Keep badges on the current page and its visible block embeds when viewing another page’s discussions. Comment text containing a block reference keeps its ordinary child bullets.
- Keep keyboard focus inside the mobile discussion panel during loading and errors.
- Existing messaging, addressed replies, tasks, mentions, and unread behavior remain available.

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
