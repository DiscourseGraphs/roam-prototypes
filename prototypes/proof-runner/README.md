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
2. It runs the kit's before-load fixtures, the flags and node types Discourse Graph reads once at
   startup. When any of them would change the graph, the panel lists what will change and waits for
   **Set up and load**; otherwise it loads straight away.
3. It loads the branch's CI build from `discoursegraphs.com/releases/roam/<branch>/` and checks the
   commit inside it against the PR head. The panel says when CI hasn't caught up yet. With URL
   loading, the build gets this extension's `extensionAPI`, with its settings stored under a `dg:`
   prefix. From `roam/js` it gets a stand-in that keeps settings in the browser.
4. **Run** plays the in-session fixtures, the baseline smoke checks, then the cases. It clicks,
   types, presses keys and runs palette commands in the page, and runs each case's check. A case
   written only as an `intent` is done by hand: the panel says what to do, and you press Done, then
   Pass or Fail. A finished run adds a line to the kit's `runs` list: the verdicts, the build and
   commit, the time, and who ran it.

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

CI builds are compiled against the production database, and tests never run there. The runner
refuses to start a CI build for a kit that needs a database, or that has or turns on sync or node
sharing; those kits need a local build of the PR against a local Supabase. Kits that only exercise
UI run on CI builds with sync and sharing off.

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
