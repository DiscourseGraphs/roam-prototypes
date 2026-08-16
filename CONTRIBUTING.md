# Contributing

## Add or change a prototype

1. Create a normal feature branch from `main`.
2. Create the workspace with the repository generator:

   ```text
   pnpm create:prototype -- --name example --title "Example" --description "What the prototype explores."
   ```

3. If a specification exists, pass `--spec path/to/SPEC.md` and read the copied `SPEC.md` before coding.
4. Work inside `prototypes/<prototype>/`. Use `roamjs-components` and `runExtension` directly.
5. Run `pnpm test`, `pnpm build`, and `pnpm prepare:artifacts`.
6. Open a pull request and use its preview URL for testing in Roam.

Prototype directory names must be lowercase kebab-case.

The generator options are:

- `--dry-run` reports the files and URLs without writing.
- `--skip-install` avoids running `pnpm install --ignore-scripts`.
- `--adopt-existing` fills a placeholder that contains only `README.md` and optional `SPEC.md`, preserving those documents.
- `--spec <markdown-file>` copies a specification as `SPEC.md`.

Do not hand-copy `packages/extension-base/template`. The generator is the supported way to create a workspace and keeps dependency/catalog references consistent.

The starter's `runExtension` wrapper handles extension lifecycle registration. In production, it also reports load failures through SamePage and may include the graph name and extension settings. Do not put credentials or sensitive data in settings.

## Artifact contract

An installable prototype must produce:

```text
prototypes/<prototype>/
├── README.md
└── dist/
    └── extension.js
```

`dist/extension.css` and either `CHANGELOG.md` or `dist/CHANGELOG.md` are optional. A `dist/README.md` may override the repository README in the published artifact.

Only these public files are deployed:

- `extension.js`
- `README.md`
- `extension.css`
- `CHANGELOG.md`

Source maps, package metadata, tests, fixtures, and source files are never deployed by the shared publisher. Any unexpected build output fails artifact preparation.

## Pull-request previews

CI builds without secrets. After it succeeds, the trusted publishing workflow uploads the packaged output to:

```text
https://discoursegraphs.com/releases/prototypes/previews/<branch-slug>/<prototype>/
```

Merging to `main` publishes the stable URL. Preview paths are overwritten by later commits on the same branch.
