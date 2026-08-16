---
name: roam-commands-navigation
description: Add Roam command-palette actions and open pages, blocks, or sidebar windows with unload-safe registrations.
---

# Commands and navigation

Use `extensionAPI.ui.commandPalette.addCommand` for extension commands when the API is provided to the lifecycle callback. Give every command a prototype-specific, user-readable label and keep its callback small. Avoid global keyboard handlers unless the specification truly needs one.

Navigate through `window.roamAlphaAPI.ui` rather than manipulating Roam URLs or internal DOM state. Relevant APIs include `mainWindow.openPage`, `mainWindow.openBlock`, and `rightSidebar.addWindow`; check their installed TypeScript signatures before use because payload shapes can change.

For every registration:

- prevent duplicate commands on reload;
- capture any disposer returned by the API, or pair direct registrations with the matching remove call;
- remove listeners and commands during unload;
- tolerate the target page/block disappearing between discovery and navigation;
- avoid stealing focus unless the user's action requests navigation.
