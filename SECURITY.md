# Security

The source repository is private, but every deployed prototype artifact is public.

Never include credentials, private research, customer data, internal API responses, privileged endpoints, or source maps containing sensitive material in a prototype build. Browser extensions cannot safely hold secrets: anything delivered to Roam can be inspected by the user and by anyone who knows the release URL.

Prototype browser source may reference only `process.env.NODE_ENV` and `process.env.VERSION`. The generator, source validator, and artifact preparation reject other `process.env` references. A public extension must call a server-side service when it needs a secret; it must never embed that secret.

The packaging and publishing scripts reject unexpected filenames and several common credential formats. These checks are defense in depth, not proof that an artifact is safe. Authors must review generated `extension.js`, `extension.css`, `README.md`, and `CHANGELOG.md` before publishing.

`BLOB_READ_WRITE_TOKEN` is a repository-level GitHub Actions secret. It is available only to the trusted post-CI publishing workflow and is never passed to feature-branch build or test steps.

Report a suspected exposure privately to the Discourse Graphs maintainers. Rotate any exposed credential immediately and remove the affected public Blob artifact.
