# Proof runner

Test a Discourse Graph pull request from a Roam page. A page holds a proof kit: the PR it proves,
and its cases written as steps a person could follow. Open the page and the runner loads that PR's
CI build of the Discourse Graph extension, opens the kit pinned in the right sidebar, and plays the
cases when you press **Run**.

## Status

Internal prototype for evaluation by Discourse Graphs, tried on `test-3-graph`. The kit format,
machine, recipes and baselines are shared with the Playwright proof runner that records PR videos,
so the same kit runs in both. Check the build you are running with `proofRunner.version` in the
browser console.

## What opening a kit page does

1. The runner reads the page's `{{proof}}` block. `pr:: 1506` looks the PR's branch up on GitHub;
   `build:: <branch>` names one directly.
2. The panel shows a checklist of what the kit needs before Run, one line per need that applies:
   the runner, this machine (for a kit that needs a database), the graph setup, the build, the
   database session, and an agent (for by-hand cases). A met line is a check mark; one that isn't
   shows the one button that meets it. When every line is met they fold into one, and Run is one
   press.
3. It runs the kit's before-load fixtures, the flags and node types Discourse Graph reads once at
   startup. When any of them would change the graph, the checklist lists what will change and waits
   for **Set up and load**; otherwise it loads straight away.
4. It loads the branch's CI build from `discoursegraphs.com/releases/roam/<branch>/` and checks the
   commit inside it against the PR head. The panel says when CI hasn't caught up yet. With URL
   loading, the build gets this extension's `extensionAPI`, with its settings stored under a `dg:`
   prefix. From `roam/js` it gets a stand-in that keeps settings in the browser.
5. **Run** plays the in-session fixtures, the baseline smoke checks, then the cases. It clicks,
   types, presses keys and runs palette commands in the page, and runs each case's check. A case
   written only as an `intent` is done by hand: the panel says what to do, and you press Done, then
   Pass or Fail. During a run the panel shows the page's own case blocks, so editing a step there
   edits the page, and Retry runs a failed step as its block reads now. A finished run adds a line
   to the kit's `runs` list: the verdicts, the build and commit, the time, and who ran it.

If Discourse Graph is already running in the graph (installed from Roam Depot), the runner doesn't
start a second copy and says so. Turn that copy off for the graph to test builds there.

A kit that names a build runs only on that build, loaded for it. After navigating to a kit for a
different PR, the panel offers **Reload with this build** and keeps Run off until you do.

Releases are served with a one-day cache, and Roam loads a URL extension through the browser cache.
After a new version is published, a hard reload (Ctrl+Shift+R) picks it up; `proofRunner.version`
says which one is running.

## A kit page

```text
{{proof}} Warn when sharing with Stored Relations off
  kit:: eng-2348
  pr:: 1506
  baseline:: dg-baseline@1
  case:: Discover shared nodes warns while Stored Relations is off
    id:: import-warns
    open import the way a user would
      use:: discover.open
    expect js:: `proof.waitFor(() => proof.callout('Stored relations are disabled'))`
  case:: Search keeps working
    intent:: run Node Search for "PK baseline" and look at the results
    expect:: the baseline nodes show and no sync error appears
```

Each step is a sentence with its action folded under it: `use:: <recipe>` (plus `with::`), any
action kind as `<kind>:: <value>`, or a code block. An attribute the parser doesn't know is an error,
so a typo can't leave a case without its check.

## What it changes

- Before-load fixtures write graph-wide flags and node types, after you press Set up and load.
- In-session fixtures create the pages a kit needs, and every finished run adds a line to the
  kit's `runs` list.
- The CI build itself writes Discourse Graph's settings on load, as any install does.

CI builds are compiled against the production database, and tests never run there. For a kit that
needs a database, or that has or turns on sync or node sharing, the runner points the PR's CI build
at the proof database before it runs: it swaps the Supabase URL and key for the proof database's and
Discourse Graph's website API for the embeddings stub, and refuses the build if anything of the
hosted stack is left. The proof database runs on the tester's machine: the checklist's **Connect
this machine** opens a `dg-proof://connect` link, which that machine's proof helper answers by
starting the database and handing the runner its address and the kits' keys. Kits that only
exercise UI (`dg-baseline@2`) run on CI builds as they are, for anyone.

## Set up your machine for Connect

Once per machine, from this folder, with Node 22 or later and a discourse-graph checkout:

```bash
pnpm helper setup --dg <path to your discourse-graph checkout>
```

Setup remembers the checkout (its migrations make the proof database's schema), runs Supabase in
Docker when Docker answers and as native processes otherwise (`--runtime docker|native`), keeps
the database's files under `~/.local/share/dg-proof` (macOS: `~/Library/Application
Support/dg-proof`), and registers `dg-proof://` links: through xdg on Linux, through a small
AppleScript app on macOS. The proof database is a separate Supabase project (`dg-proof`, API on
`127.0.0.1:55321`), so it never touches the database you develop against. After that, a kit page's
**Connect this machine** starts it, and **Disconnect** stops what Connect started. By hand:
`pnpm helper start`, `stop`, `status`, `uninstall`. The helper answers only roamresearch.com pages,
on `127.0.0.1:8766`.

## Agent tools

With Roam's AI API (`extensionAPI.ai.addTool`), the runner registers tools an agent connected to the
graph can call: `proof_status`, `proof_snapshot`, `proof_control`, `proof_add_steps` and
`proof_fix_step`. An agent can read a kit and its run, see the page's dialogs and controls, run and
pause, write steps for a by-hand case onto the page, and fix a failed step. Js an agent writes waits
for an Allow in the panel, and verdicts stay with the person. The checklist's **Ask your agent**
opens a `dg-proof://agent` link that starts one. From `roam/js` there is no `extensionAPI`, so no
tools.

Kit pages run their own js when you press Run, so keep kits in graphs shared with people you trust,
as with `roam/js`.

## Install from a URL

In Roam, use **Load Developer Extensions from URL** with:

```text
https://discoursegraphs.com/releases/prototypes/proof-runner/
```

Roam supplies the extension API, loads `extension.css`, and unloads the extension in this mode.

## Load from roam/js

Paste this loader into a `roam/js` code block. To test a pull-request preview, change only `baseUrl` to the preview release directory posted on the pull request.

```javascript
(async () => {
  const baseUrl =
    "https://discoursegraphs.com/releases/prototypes/proof-runner";
  const globalKey = "__roamPrototype:proof-runner";
  const loadKey = `${globalKey}:load`;

  const previousLoad = window[loadKey] ?? Promise.resolve();
  const currentLoad = previousLoad.catch(() => {}).then(async () => {
    const version = Date.now();
    const previous = window[globalKey];
    const previousExtension = previous?.extension ?? previous;

    // Import and validate the replacement before unloading a working copy.
    const module = await import(`${baseUrl}/extension.js?v=${version}`);
    const extension = module.default;
    if (!extension?.onload || !extension?.onunload) {
      throw new Error("The loaded module is not a Roam extension.");
    }

    if (previousExtension?.onunload) {
      await previousExtension.onunload();
    }
    previous?.stylesheet?.remove();
    delete window[globalKey];

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${baseUrl}/extension.css?v=${version}`;
    stylesheet.dataset.roamPrototype = "proof-runner";

    try {
      document.head.appendChild(stylesheet);
      await extension.onload({
        extensionAPI: undefined,
        extension: { version: "roam/js" },
      });
      window[globalKey] = { extension, stylesheet };
    } catch (error) {
      try {
        await extension.onunload();
      } catch (cleanupError) {
        console.error(
          "Could not clean up the failed Proof runner load:",
          cleanupError,
        );
      }
      stylesheet.remove();
      throw error;
    }
  });

  window[loadKey] = currentLoad;
  try {
    await currentLoad;
  } finally {
    if (window[loadKey] === currentLoad) delete window[loadKey];
  }
})().catch((error) => {
  console.error("Could not load Proof runner:", error);
});
```

A `roam/js` block can use global `window.roamAlphaAPI` capabilities, but Roam does not provide the extension-scoped `extensionAPI` through this loading path. Features that require extension settings or other `extensionAPI` methods are available only with URL loading unless the prototype provides a fallback.
