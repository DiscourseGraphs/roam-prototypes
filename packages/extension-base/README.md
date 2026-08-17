# Extension base

Shared esbuild tooling, configuration, template files, and agent references for prototypes in this repository.

This is not a browser runtime abstraction and is not published. Generated prototypes import `roamjs-components` directly and declare this workspace package as a development-only dependency for its `roam-prototype` CLI.

Create a prototype from the repository root:

```text
pnpm create:prototype -- --name example --title "Example" --description "What the prototype explores."
```

The generator renders `template/` into `prototypes/<name>/`. Change the template only when changing the convention for future prototypes; prototype-specific work belongs in its own directory.

## Build tooling

The shared CLI is modeled on `apps/roam` in the Discourse Graphs monorepo. It bundles TypeScript and imported CSS with esbuild, maps Roam-provided browser globals, injects non-secret build metadata used by `runExtension`, and writes public files to `dist/`. It does not publish artifacts.

Run `pnpm dev` from a generated prototype to invoke `roam-prototype dev`, which watches the source and rebuilds `dist/` on changes. The terminal confirms the initial build and every successful update. Reloading the developer extension in Roam remains controlled by Roam's reload command or hotkey. `roam-prototype build` creates a minified production bundle without source maps. README and CHANGELOG files are copied into `dist/`; imported CSS is emitted as `extension.css`.

The starter imports the lifecycle wrapper as a named export:

```ts
import { runExtension } from "roamjs-components/util";
```

Its production error reporting to SamePage is behavior inside `roamjs-components`, independent of which bundler produced `extension.js`; reports include the graph name and extension settings. Never store credentials or sensitive data in extension settings.
