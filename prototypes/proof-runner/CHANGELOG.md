# Changelog

## 0.1.0 - 2026-10-05

- Load a pull request's CI build from a proof kit page, after asking before any graph-wide setup.
- Run the kit's cases from a panel pinned in the right sidebar, with by-hand cases, verdicts, and a run log on the page.
- Hand the build this extension's `extensionAPI` with URL loading; use a browser-storage stand-in from `roam/js`.
- Show the page's own case blocks in the panel, so editing a step edits the page; Retry runs a failed step as its block reads now.
- Show what a kit needs before Run as a checklist, each unmet need with the one button that meets it.
- Point a pull request's CI build at the proof database for kits that need one, and start that database from the panel with Connect this machine.
- Register agent tools with Roam's AI API, and open the person's agent on a kit with Ask your agent.
