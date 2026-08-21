---
name: roam-react-rendering
description: Render React or Roam-aware UI in a prototype while respecting host DOM boundaries and extension unload.
---

# React and Roam rendering

Prefer existing `roamjs-components` primitives for Roam-consistent controls, dialogs, toasts, settings, and observers. Scope prototype CSS under a unique class such as `.roam-prototype-<slug>` so it cannot restyle the graph globally.

Import those primitives as named exports from package barrels. This repository emits ESM, but `roamjs-components` is published as TypeScript-compiled CommonJS; a default import from a published subpath can bind `{ default: fn }` instead of the function. For example:

```ts
import { addStyle } from "roamjs-components/dom";
import { runExtension } from "roamjs-components/util";
```

With URL loading, Roam automatically injects and removes a published `extension.css`. The extension API also automatically cleans up its commands, slash commands, settings panel, and experimental AI tools. The documented `roam/js` loader manages `extension.css`, but has no extension API, so feature-detect extension-scoped capabilities and explicitly clean up any fallback registrations. DOM nodes, observers, event listeners, intervals, and custom registered components remain the extension's responsibility in both modes.

Use the supported Roam renderers when the UI is fundamentally Roam content:

- Declarative JSX: `roamAlphaAPI.ui.react.Block`, `.Page`, `.Search`, and `.BlockString`.
- Imperative DOM: `roamAlphaAPI.ui.components.renderBlock`, `.renderPage`, `.renderSearch`, and `.renderString`.
- Pair every imperative render with `roamAlphaAPI.ui.components.unmountNode` during cleanup.

Use a custom React tree when the prototype owns a larger interface or needs state and composition beyond those Roam renderers.

When mounting custom React UI:

1. Create a dedicated container with a prototype-specific data attribute or class.
2. Mount one React tree per container with the React/ReactDOM version supplied by Roam. When using `runExtension`, register the owned container in its `reactRoots` registry so its unload path calls the host-compatible unmount and removes the container.
3. Observe Roam DOM changes only at the narrowest stable ancestor and deduplicate mounts.
4. On unload, disconnect observers, unmount every React tree, remove owned containers, clear timers/listeners, and unregister any component registered with `roamAlphaAPI.ui.mainWindow.registerComponent`.
5. Do not depend on obfuscated Blueprint/Roam implementation classes when a semantic selector or supported observer helper exists.

Keep graph access outside presentational components. Render loading, empty, stale-target, and failure states. Roam is a long-lived single-page host, so a missing cleanup path becomes a duplicate UI or memory leak after extension reload.
