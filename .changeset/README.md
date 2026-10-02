# Changesets

This repo uses [changesets](https://github.com/changesets/changesets) to manage versions and publish to npm.

## Adding a changeset

When you make a change worth releasing, run:

```bash
yarn changeset
```

Pick the affected packages, choose the bump and write a short summary for that package's users. [`CONTRIBUTING.md`](../CONTRIBUTING.md#changesets) says which changes need a changeset and how to write it. A markdown file is written under `.changeset/`. Commit it with your PR.

`@scoutui/cli` is the only package published to npm. `@scoutui/web-app` is released as a container image and a Helm chart (see [Releasing](#releasing)). The other packages are private and never published; the CLI bundles `parser-react`, `parser-vue`, `reference-graph` and `scan-format`.

## Releasing

Maintainers release from `main`. `.github/workflows/release.yml` opens a version pull request from the pending changesets, and merging it releases what it versions:

- **The CLI** goes to npm, with a GitHub Release `@scoutui/cli@X.Y.Z`.
- **The web app** is pushed as `ghcr.io/scoutui/scout-web-app:X.Y.Z` for amd64 and arm64, and `latest` moves to it if it's the newest version. Then the GitHub Release `web-app@X.Y.Z` is created, and the chart that runs it is published to `oci://ghcr.io/scoutui/charts/scout`.

The release refuses a web app version whose image tag was already pushed from another commit. If the image or chart job fails, re-run it on the release commit: a later push doesn't release that version. Other commits on `main` push only the image's `main` and `main-<sha>` tags.

Snapshot builds come from `/snapit`; see `.github/workflows/snapit.yml`.
