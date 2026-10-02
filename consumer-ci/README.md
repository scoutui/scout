# consumer-ci

Clones real public consumer repos, installs them, and runs `scout scan` against
their **app** directories (never the component-library packages). A nightly job
scans each target's latest commit and uploads it to the
configured host (`SCOUTUI_HOST`, a repo secret, not a literal), building the
adoption time-series.

It runs each target in two steps, so the target's install and codegen
(`nuxt prepare` and the like) run code from the target's latest commit without
the upload token in their environment:

1. `--step prepare --work-dir <dir>` clones and installs the target into
   `<dir>/<target name>`, with no secrets.
2. `--step scan --work-dir <dir>` scans that work tree and uploads, with
   `SCOUTUI_HOST` and `SCOUTUI_TOKEN` set.

Both steps run in the same job, so this keeps the token out of the target's
code only while that code runs: a process it leaves behind, or a file it
changes, is still there when the scan step runs. Without `--step`, one run
does both and removes the work tree afterward.

## Run locally

```bash
# Build the CLI the harness invokes:
yarn turbo run build --filter=@scoutui/cli
# Clone and install one target into /tmp/consumer-ci/elk (minutes for large repos):
yarn workspace consumer-ci run cadence --target elk --step prepare --work-dir /tmp/consumer-ci
```

The prepared work tree is ready for the before-and-after scan in
[Check against a real repo](../CODING_STANDARDS.md#check-against-a-real-repo). The
scan step uploads, so it needs `SCOUTUI_HOST` and `SCOUTUI_TOKEN`.

Requires `corepack` enabled (targets are yarn@4). The CLI is invoked by absolute
path, so a stale pre-rename bin symlink in a target's `node_modules/.bin` won't interfere.

The install uses `yarn install --immutable`, which expects the target's committed
lockfile to match the install platform. CI runs on Linux (where the targets' lockfiles
are generated), so it passes there; running locally on macOS can trip `--immutable` on
platform-only optional deps (e.g. `fsevents`). The harness clones from the public
registry. If your network blocks `registry.yarnpkg.com`, point yarn elsewhere for the
run, e.g. `YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org yarn workspace consumer-ci run cadence ...`.

## Add a target

Append to `targets.ts`. Each scan needs a `repoId` unique across the whole matrix
(it keys the time-series) and per-app `include` globs. Add the new `name` to the
workflow's `matrix.target` list.
