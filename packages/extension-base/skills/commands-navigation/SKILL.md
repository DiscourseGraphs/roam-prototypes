---
name: roam-commands-navigation
description: Add Roam command-palette actions and open pages, blocks, or sidebar windows with unload-safe registrations.
---

# Commands and navigation

Use `await extensionAPI.ui.commandPalette.addCommand(...)` for extension commands when the API is provided to the lifecycle callback. It returns `null`, not a disposer. Roam automatically removes commands registered through `extensionAPI` when the extension unloads, and namespaces/groups them under the extension. Give every command a user-readable label and keep its callback small. Avoid global keyboard handlers and default hotkeys unless the specification truly needs them; users can assign hotkeys in Settings.

Navigate through `window.roamAlphaAPI.ui` rather than manipulating Roam URLs or internal DOM state. Await `mainWindow.openPage({page: {uid}})`, `mainWindow.openBlock({block: {uid}})`, and `rightSidebar.addWindow({window: {...}})`. Right-sidebar window types include `block`, `outline`, `mentions`, `graph`, and `search-query`; the first four use `block-uid`, while search windows use `search-query-str`.

For every registration:

- prefer `extensionAPI.ui` so extension commands and slash commands receive automatic cleanup;
- if the global `roamAlphaAPI.ui.commandPalette` is deliberately used, pair it with `removeCommand({label})` during unload;
- unregister custom main-window components and remove global listeners during unload;
- tolerate the target page/block disappearing between discovery and navigation;
- avoid stealing focus unless the user's action requests navigation.
