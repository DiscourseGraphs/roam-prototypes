# Extension base

Shared configuration, template files, and agent references for prototypes in this repository.

This is not a runtime abstraction and is not published. Generated prototypes import `roamjs-components` directly and use the SamePage CLI declared in their own `devDependencies`.

Create a prototype from the repository root:

```text
pnpm create:prototype -- --name example --title "Example" --description "What the prototype explores."
```

The generator renders `template/` into `prototypes/<name>/`. Change the template only when changing the convention for future prototypes; prototype-specific work belongs in its own directory.

## SamePage responsibilities

SamePage bundles TypeScript and React, maps Roam-provided browser globals, and writes public files to `dist/`. It does not publish artifacts from this repository.

The starter uses `roamjs-components/util/runExtension`. In production, that wrapper reports load failures to SamePage and includes the graph name and extension settings. Never store credentials or sensitive data in extension settings.
