# Contributing

## Add or change a prototype

1. Create a normal feature branch from `main`.
2. Work inside `prototypes/<prototype>/`.
3. Add a workspace `package.json` with a `build` script when the prototype needs a build.
4. Write the installable output to `prototypes/<prototype>/dist/`.
5. Run `npm test`, `npm run build`, and `npm run prepare:artifacts`.
6. Open a pull request and use its preview URL for testing in Roam.

Prototype directory names must be lowercase kebab-case.

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

Source maps, package metadata, tests, fixtures, and source files are never deployed by the shared publisher.

## Pull-request previews

CI builds without secrets. After it succeeds, the trusted publishing workflow uploads the packaged output to:

```text
https://discoursegraphs.com/releases/prototypes/previews/<branch-slug>/<prototype>/
```

Merging to `main` publishes the stable URL. Preview paths are overwritten by later commits on the same branch.

