# __PROTOTYPE_TITLE__

__PROTOTYPE_DESCRIPTION__

## Status

Internal prototype for evaluation by Discourse Graphs.

## Features

- Document the prototype's user-visible behavior here.

## Install from a URL

In Roam, use **Load Developer Extensions from URL** with:

```text
https://discoursegraphs.com/releases/prototypes/__PROTOTYPE_NAME__/
```

Roam supplies the extension API, loads `extension.css`, and unloads the extension in this mode.

## Load from roam/js

Paste this loader into a `roam/js` code block. To test a pull-request preview, change only `baseUrl` to the preview release directory posted on the pull request.

```javascript
(async () => {
  const baseUrl =
    "https://discoursegraphs.com/releases/prototypes/__PROTOTYPE_NAME__";
  const globalKey = "__roamPrototype:__PROTOTYPE_NAME__";
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
    stylesheet.dataset.roamPrototype = "__PROTOTYPE_NAME__";

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
          "Could not clean up the failed __PROTOTYPE_TITLE__ load:",
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
  console.error("Could not load __PROTOTYPE_TITLE__:", error);
});
```

A `roam/js` block can use global `window.roamAlphaAPI` capabilities, but Roam does not provide the extension-scoped `extensionAPI` through this loading path. Features that require extension settings or other `extensionAPI` methods are available only with URL loading unless the prototype provides a fallback.
