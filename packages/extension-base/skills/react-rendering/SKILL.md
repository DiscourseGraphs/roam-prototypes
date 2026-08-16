---
name: roam-react-rendering
description: Render React or Roam-aware UI in a prototype while respecting host DOM boundaries and extension unload.
---

# React and Roam rendering

Prefer existing `roamjs-components` primitives for Roam-consistent controls, dialogs, toasts, settings, and observers. Scope prototype CSS under a unique class such as `.roam-prototype-<slug>` so it cannot restyle the graph globally.

When mounting custom React UI:

1. Create a dedicated container with a prototype-specific data attribute or class.
2. Mount one React root per container and retain the root reference.
3. Observe Roam DOM changes only at the narrowest stable ancestor and deduplicate mounts.
4. On unload, disconnect observers, unmount every React root, remove owned containers, and clear timers/listeners.
5. Do not depend on obfuscated Blueprint/Roam implementation classes when a semantic selector or supported observer helper exists.

Keep graph access outside presentational components. Render loading, empty, stale-target, and failure states. Roam is a long-lived single-page host, so a missing cleanup path becomes a duplicate UI or memory leak after extension reload.
