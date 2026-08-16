# Instructions for coding agents

This is a pnpm monorepo for public, installable Roam developer-extension artifacts whose source remains private.

## Creating a prototype

- Always create a workspace with `pnpm create:prototype -- --name <kebab-case> --title "<title>" --description "<public description>"`.
- Pass `--spec <file>` when a specification is provided. Read `SPEC.md` completely before implementation.
- Use `--adopt-existing` only for a placeholder containing `README.md` and optional `SPEC.md`. Preserve those documents.
- Do not copy the template by hand or create a branch/repository per prototype.

## Implementation rules

- Keep prototype code inside `prototypes/<slug>` and shared convention material inside `packages/extension-base`.
- Import `roamjs-components` directly. `packages/extension-base` is build tooling, configuration, and a template, not a browser runtime API.
- Read the relevant guidance under `packages/extension-base/skills` before using Roam graph writes, commands, navigation, or React rendering.
- For new graph reads, prefer `await window.roamAlphaAPI.data.async.*`. Never use legacy top-level aliases such as `roamAlphaAPI.q`, `roamAlphaAPI.pull`, or `roamAlphaAPI.createBlock`.
- Keep `runExtension` as the lifecycle wrapper. Dispose observers, listeners, commands, timers, and mounted UI when the extension unloads.
- Never edit generated `dist` files. Build them with pnpm and the shared esbuild CLI.
- Keep all browser code and public documentation secret-free. Only `process.env.NODE_ENV` and `process.env.VERSION` are allowed.

## Validation

Run `pnpm test`, `pnpm build`, and `pnpm prepare:artifacts`. Only `extension.js`, `README.md`, optional `extension.css`, and optional `CHANGELOG.md` may be published.
