---
description: "Add the Scout CLI to a repo as a dev dependency, switch Yarn off Plug'n'Play if needed, and check that the command runs."
sidebar_label: "Install the CLI"
---

# Install the CLI

Add `@scoutui/cli` to a repo so you can run `scout` there. You need Node.js 24 or later.

## 1. Add the package

In the repo root, add the CLI as a dev dependency with your package manager:

```bash
npm install --save-dev @scoutui/cli
# or: yarn add -D @scoutui/cli
# or: pnpm add -D @scoutui/cli
```

:::warning
The scan needs all of the repo's dependencies installed, not just the CLI. Without them, it can't find the components those packages provide, and `scan` refuses with:

```
Error: Couldn't upload the scan: @acme/ui is listed in package.json but isn't installed. Install your dependencies and try again.
```

In a fresh clone or a CI job, run your package manager's install (`npm ci`, `yarn install` or `pnpm install`) before you scan.
:::

## 2. Switch Yarn off Plug'n'Play

Skip this step if you use npm, pnpm, or Yarn 1.

Scout needs a `node_modules` folder. Yarn 2 and later use Plug'n'Play instead unless `.yarnrc.yml` says otherwise, and a scan there stops with:

```
Error: Scout can't read packages installed with Yarn Plug'n'Play. Set nodeLinker: node-modules in .yarnrc.yml, run yarn install, and scan again.
```

To fix it:

1. Set `nodeLinker` in `.yarnrc.yml`:

   ```yaml title=".yarnrc.yml"
   nodeLinker: node-modules
   ```

2. Reinstall so Yarn writes `node_modules`:

   ```bash
   yarn install
   ```

If the scan still stops with the same error, delete any `.pnp.cjs` or `.pnp.loader.mjs` left in the folder that holds `scout.config.json`, or at the root of its monorepo.

## 3. Check the command runs

```bash
npx scout --version
# or: yarn scout --version
# or: pnpm exec scout --version
```

It prints the installed version, for example:

```
0.1.0
```

## Check what the CLI contains

The package ships a [CycloneDX](https://cyclonedx.org/) software bill of materials at `node_modules/@scoutui/cli/dist/sbom.cdx.json`. It lists the third-party packages bundled into the CLI and the packages it installs, so your dependency scanner can check them. Each CLI release on [GitHub Releases](https://github.com/scoutui/scout/releases) has the same file attached.

## Next

- To run a first scan end to end, follow [Scan your first repo](/docs/tutorials/scan-your-first-repo).
- To set up a scan for your repo's layout, see [Configure a scan](/docs/guides/configure-a-scan).
