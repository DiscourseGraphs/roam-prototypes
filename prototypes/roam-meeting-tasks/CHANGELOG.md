# Changelog

## 0.1.0 - 2026-09-29

Port of the dg-team `roam/render` meeting-tasks component into an installable extension.

- The widget's code moves out of the graph. The `roam/render` code block now holds a short shim
  that hands the extension an element to render into, so existing invocations keep working.
- Graph reads use `data.async.*` and run after the widget renders instead of during Roam's render.
- Widgets on the same page share one set of reads.
- Four list-bound Datalog queries are replaced with `pull_many`; the meeting and task scans start
  from reverse references. On `Sync / All Hands` one widget went from 1.6 to 2.0 s of blocking
  work to about 390 ms after render, and later widgets on the page reuse the first one's reads.
- The collapsed section is read and rendered only when opened. Block references in item text are
  read in one batch instead of one query each.
- Checkbox writes use `data.block.update`, update every widget showing the task, and revert if the
  write fails.
- Fixes: date brackets in the "From last meeting" label, block references nested inside other
  references, wrapper chains, and forcing `meeting` mode outside a meeting.
