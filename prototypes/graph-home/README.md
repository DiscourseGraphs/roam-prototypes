# Graph Home

A navigation hub for a Roam graph home page.

## Status

Internal prototype for evaluation by Discourse Graphs.

## Features

- The four shortcuts appear in one row when the Home content area is at least 900 pixels wide, in a 2 × 2 grid from 600 to 899 pixels, and as directory rows below 600 pixels. Opening or resizing the Roam sidebar can switch the layout.
- Open the team front page, Dashboard, My Homepage, or Sync / All Hands from the main **🥾 Home** page. Shift-click opens a shortcut in the right sidebar. Ctrl-click or Command-click opens it in a new tab.
- **My Homepage** looks up the signed-in user's display name and opens the existing <code>&lt;display name&gt;/Home</code> page.
- The extension hides the two legacy Kanban boards on the main Home page while the launcher is active. Unloading restores the boards. The extension uses read-only graph access.

## Install from a URL

In Roam, use **Load Developer Extensions from URL** with:

```text
https://discoursegraphs.com/releases/prototypes/graph-home/
```

For a pull request, use the preview directory URL from the **Roam prototype previews** comment.

Roam supplies the extension API, loads `extension.css`, and unloads the extension in this mode.

## Load from roam/js

Paste this loader into a `roam/js` code block. To test a pull-request preview, change only `baseUrl` to the preview release directory posted on the pull request.

```javascript
(async () => {
  const baseUrl = "https://discoursegraphs.com/releases/prototypes/graph-home";
  const globalKey = "__roamPrototype:graph-home";
  const loadKey = `${globalKey}:load`;

  const previousLoad = window[loadKey] ?? Promise.resolve();
  const currentLoad = previousLoad
    .catch(() => {})
    .then(async () => {
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
      stylesheet.dataset.roamPrototype = "graph-home";

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
            "Could not clean up the failed Graph Home load:",
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
  console.error("Could not load Graph Home:", error);
});
```

A `roam/js` block can use global `window.roamAlphaAPI` capabilities, but Roam does not provide the extension-scoped `extensionAPI` through this loading path. Features that require extension settings or other `extensionAPI` methods are available only with URL loading unless the prototype provides a fallback.
